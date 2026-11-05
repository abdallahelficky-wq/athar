import { describe, expect, it } from "vitest";
import { buildPayrollJournal, type BuildPayrollJournalInput, type JournalComponent, type EmployeeAllocation } from "./payrollJournal";

/**
 * توجيه قيد الرواتب بعد حادثة J02106 (أرمي، أكتوبر 2026): الأسطر مأخوذة من buildPayrollJournal نفسها — الدالة التي
 * يرحّل postPayrollRun مُخرَجها كما هو.
 * 1) خصم السلفة المُدخَل في الكشف يُرحَّل دائناً على حساب ذمة كل موظف، لا على الحساب المشترك.
 * 2) الراتب الأساسي يُرحَّل على حساب مصروف رواتب قسم الموظف إن حُدِّد.
 */
const ACC = {
  headOffice: "acc-611001", field: "acc-611002", sharedAdvances: "acc-113002", net: "acc-212001",
  ibrahim: "acc-118002", ashraf: "acc-118010",
};

const components = new Map<string, JournalComponent>([
  ["basic", { id: "basic", name: "الراتب الأساسي", kind: "addition", accountId: ACC.headOffice, systemKey: "basic" }],
  ["advance", { id: "advance", name: "سلف الموظفين", kind: "deduction", accountId: ACC.sharedAdvances, systemKey: "advance" }],
  ["otherDed", { id: "otherDed", name: "استقطاعات أخرى", kind: "deduction", accountId: ACC.headOffice, systemKey: "otherDed" }],
]);

const employees = new Map<string, EmployeeAllocation>([
  ["ibrahim", { departmentId: "dep-factory", departmentName: "المصنع", costCenterId: "cc-iron", salaryExpenseAccountId: ACC.field }],
  ["ashraf", { departmentId: "dep-admin", departmentName: "الإدارة", costCenterId: "cc-admin", salaryExpenseAccountId: ACC.headOffice }],
]);

const accountTypeById = new Map([
  [ACC.headOffice, "expense"], [ACC.field, "expense"], [ACC.sharedAdvances, "asset"], [ACC.ibrahim, "asset"], [ACC.ashraf, "asset"],
]);

function input(overrides: Partial<BuildPayrollJournalInput> = {}): BuildPayrollJournalInput {
  return {
    mode: "totals",
    rows: [
      { employeeId: "ibrahim", employeeName: "IBRAHIM ABDULLAH", componentValues: { basic: 2500, advance: 750 } },
      { employeeId: "ashraf", employeeName: "أشرف الصايغ", componentValues: { basic: 3000, advance: 1000, otherDed: 100 } },
    ],
    components, employees, accountTypeById, netPayableAccountId: ACC.net,
    resolveAdvanceAccount: (id) => (id === "ibrahim" ? ACC.ibrahim : ACC.ashraf),
    ...overrides,
  };
}

describe("payroll journal routing (J02106)", () => {
  it("credits each employee's own receivable account for advance deductions — never the shared advances account", () => {
    const { lines } = buildPayrollJournal(input());
    expect(lines.some((l) => l.accountId === ACC.sharedAdvances)).toBe(false);
    const ibrahim = lines.find((l) => l.accountId === ACC.ibrahim)!;
    const ashraf = lines.find((l) => l.accountId === ACC.ashraf)!;
    expect(ibrahim).toMatchObject({ credit: 750, debit: 0, employeeId: "ibrahim", costCenterId: null });
    expect(ashraf).toMatchObject({ credit: 1000, debit: 0, employeeId: "ashraf" });
    expect(ibrahim.lineDescription).toContain("IBRAHIM ABDULLAH");
  });

  it("debits basic salary to the employee department's salary expense account, keeping department and cost center", () => {
    const { lines } = buildPayrollJournal(input());
    expect(lines.find((l) => l.accountId === ACC.field && l.debit)).toMatchObject({ debit: 2500, departmentId: "dep-factory", costCenterId: "cc-iron" });
    expect(lines.find((l) => l.accountId === ACC.headOffice && l.debit)).toMatchObject({ debit: 3000, departmentId: "dep-admin", costCenterId: "cc-admin" });
    // التخفيض على مصروف الراتب يتبع حساب القسم نفسه
    expect(lines.find((l) => l.accountId === ACC.headOffice && l.credit)).toMatchObject({ credit: 100, departmentId: "dep-admin" });
  });

  it("falls back to the basic component account when the department has no salary account", () => {
    const noDeptAccount = new Map(employees);
    noDeptAccount.set("ibrahim", { ...employees.get("ibrahim")!, salaryExpenseAccountId: null });
    const { lines } = buildPayrollJournal(input({ employees: noDeptAccount }));
    expect(lines.some((l) => l.accountId === ACC.field)).toBe(false);
    expect(lines.filter((l) => l.accountId === ACC.headOffice && l.debit).reduce((s, l) => s + l.debit, 0)).toBe(5500);
  });

  it("stays balanced to the halala", () => {
    const { lines } = buildPayrollJournal(input());
    const debit = lines.reduce((s, l) => s + l.debit, 0), credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    expect(lines.find((l) => l.accountId === ACC.net)).toMatchObject({ credit: 3650 });
  });

  it("refuses to post when advance receivable accounts are not configured", () => {
    expect(() => buildPayrollJournal(input({ resolveAdvanceAccount: undefined }))).toThrow(/حساب ذمة الموظف الفرعي/);
  });

  it("refuses a manual advance deduction alongside an advances-screen installment for the same employee (double deduction)", () => {
    const rows = input().rows.map((r) => (r.employeeId === "ibrahim" ? { ...r, advanceInstallments: [{ advanceId: "adv-1", accountId: ACC.ibrahim, amount: 750 }] } : r));
    expect(() => buildPayrollJournal(input({ rows }))).toThrow(/مرتين/);
  });

  it("per-employee mode also routes the advance to the employee's receivable account", () => {
    const withNet = new Map([...employees].map(([id, e]) => [id, { ...e, netAccountId: ACC.net }]));
    const { lines } = buildPayrollJournal(input({ mode: "perEmployee", employees: withNet }));
    expect(lines.find((l) => l.accountId === ACC.ibrahim)).toMatchObject({ credit: 750 });
    expect(lines.some((l) => l.accountId === ACC.sharedAdvances)).toBe(false);
  });
});
