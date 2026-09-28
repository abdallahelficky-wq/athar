import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { hashPassword } from "../../lib/password";
import { signAccessToken } from "../../lib/jwt";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * الرواتب بالإجماليات، وطيّ بيانات الموظفين لغير أدوار الموارد البشرية، عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * - قبل شهر التحويل: سطر لكل موظف وصافٍ على حسابه الفرعي (لا تغيير)؛ من شهر التحويل: سطر لكل بند وصافٍ واحد
 *   على «رواتب مستحقة»، وقسط السلفة وحده سطر باسم الموظف؛ الشهر للمالك وحده ومسجَّل في التدقيق.
 * - المحاسب (غير الموارد البشرية): قيد الرواتب القديم مطويّ لكل حساب؛ «ذمم الموظفين» رصيد واحد في ميزان المراجعة
 *   والشجرة والمركز المالي وشجرة الحسابات والأستاذ؛ لا كشف ولا فلترة بحساب موظف بعينه؛ الأرقام متوازنة.
 * - تسوية الإجازة: اسم الموظف محذوف من البيان في القيود والأستاذ ولوحة المتابعة وقيد العكس، والبحث بالاسم لا يجدها.
 * - السلفة تبقى باسم صاحبها للجميع حيث رُحِّلت.
 */
guardAgainstUnsafeIntegrationTestDatabase();

// سند القيد PDF: يُلتقَط ما يُمرَّر لمولّد الـPDF (وهو ما يُطبَع) بدل تشغيل متصفح في بيئة الاختبار
const pdfInputs: unknown[] = [];
vi.mock("../../lib/journalVoucherPdf", () => ({
  buildJournalVoucherPdf: async (input: unknown) => {
    pdfInputs.push(input);
    return Buffer.from("%PDF-test");
  },
}));

const stamp = Date.now();
const email = `payroll-totals-${stamp}@example.com`;
const accountantEmail = `payroll-totals-acct-${stamp}@example.com`;
const PIN = "3391";
let server: Server;
let baseUrl = "";
let ownerToken = "";
let accountantToken = "";
let tenantId = "";
let companyId = "";
let salaryExpenseId = "";
let advanceAccountId = "";
let basicComponentId = "";
let employeesGroupId = "";
let payableId = "";
const emp: Record<"a" | "b", { id: string; accountId: string; name: string }> = {} as never;

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function createEmployee(name: string, basic: number) {
  const res = await call("POST", "/employees", ownerToken, {
    companyId, name, hireDate: "2024-01-01", basicSalary: basic, gosiApplicable: false,
  });
  expect(res.status, res.text).toBe(201);
  const set = await call("PUT", `/employees/${res.body.id}/payroll-components`, ownerToken, [{ componentId: basicComponentId, fixedValue: basic, isActive: true }]);
  expect(set.status, set.text).toBeLessThan(300);
  const row = await prisma.employee.findUniqueOrThrow({ where: { id: res.body.id } });
  return { id: row.id, accountId: row.accountId!, name };
}

async function postRun(month: string) {
  const run = await call("POST", "/payroll-runs", ownerToken, { companyId, month, employeeIds: [emp.a.id, emp.b.id] });
  expect(run.status, run.text).toBe(201);
  const posted = await call("POST", `/payroll-runs/${run.body.id}/post`, ownerToken);
  expect(posted.status, posted.text).toBe(200);
  return prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.body.journalEntryId }, include: { lines: true } });
}

const sum = (xs: { debit: unknown; credit: unknown }[], side: "debit" | "credit") => Math.round(xs.reduce((s, l) => s + Number(l[side]), 0) * 100) / 100;

describe("payroll totals posting and the non-HR collapse (integration)", () => {
  let juneEntryId = "";
  let julyEntryId = "";
  let settlementEntryId = "";
  let payoutId = "";

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `رواتب إجمالية ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    ownerToken = r.accessToken;
    await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;

    const identity = await prisma.identity.create({ data: { email: accountantEmail } });
    const accountant = await prisma.user.create({
      data: { tenantId, identityId: identity.id, name: "محاسب", role: "accountant", companyScope: "all", inviteStatus: "accepted" },
    });
    accountantToken = signAccessToken({ sub: accountant.id, tenantId, role: "accountant", companyScope: "all", readOnly: false });

    salaryExpenseId = await getAccountIdByName(tenantId, companyId, "مصروف رواتب");
    payableId = await getAccountIdByName(tenantId, companyId, "رواتب مستحقة للصرف");
    advanceAccountId = (await prisma.account.findFirstOrThrow({ where: { companyId, name: "سلف وقروض الموظفين", isPosting: true } })).id;
    const component = await call("POST", `/companies/${companyId}/payroll-components`, ownerToken, {
      name: "الراتب الأساسي", kind: "addition", accountId: salaryExpenseId, calcMethod: "fixed", appliesByDefault: false,
    });
    expect(component.status, component.text).toBe(201);
    basicComponentId = component.body.id;

    emp.a = await createEmployee(`أحمد الاختبار ${stamp}`, 5000);
    emp.b = await createEmployee(`خالد الاختبار ${stamp}`, 4000);
    employeesGroupId = (await prisma.account.findUniqueOrThrow({ where: { id: emp.a.accountId } })).parentId!;

    const advance = await call("POST", "/employee-advances", ownerToken, {
      companyId, employeeId: emp.a.id, accountId: advanceAccountId, amount: 1200, monthlyInstallment: 300, startDate: "2026-05-01",
    });
    expect(advance.status, advance.text).toBe(201);

    juneEntryId = (await postRun("2026-06")).id;
  }, 180_000);

  afterAll(async () => {
    server?.close();
    await prisma.attachment.deleteMany({ where: { tenantId } });
    await prisma.payrollRun.deleteMany({ where: { tenantId } });
    await prisma.leaveSettlement.deleteMany({ where: { tenantId } });
    await prisma.employeeAdvanceDeduction.deleteMany({ where: { employeeAdvance: { tenantId } } });
    await prisma.employeeAdvance.deleteMany({ where: { tenantId } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email: { in: [email, accountantEmail] } } });
  });

  it("the employee sub-accounts' group is flagged as personal when it is created", async () => {
    const group = await prisma.account.findUniqueOrThrow({ where: { id: employeesGroupId } });
    expect(group.name).toBe("ذمم الموظفين");
    expect(group.isPersonalGroup).toBe(true);
  });

  it("before a switchover month, payroll posts per employee to each employee's sub-account (unchanged)", async () => {
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: juneEntryId }, include: { lines: true } });
    const net = entry.lines.filter((l) => l.accountId === emp.a.accountId || l.accountId === emp.b.accountId);
    expect(net.map((l) => Number(l.credit)).sort()).toEqual([4000, 4700]);
    expect(entry.lines.filter((l) => l.accountId === salaryExpenseId)).toHaveLength(2);
    expect(entry.lines.find((l) => l.employeeAdvanceId)?.employeeId).toBe(emp.a.id);
  });

  it("HR roles see a legacy payroll entry line by line; an accountant sees it collapsed per account", async () => {
    const full = await call("GET", `/journal-entries/${juneEntryId}`, ownerToken);
    expect(full.body.lines.filter((l: { employeeId: string | null }) => l.employeeId)).toHaveLength(5);
    expect(full.body.hrCollapsed).toBeUndefined();
    expect(full.body.payrollRunId).toBeTruthy();

    const collapsed = await call("GET", `/journal-entries/${juneEntryId}`, accountantToken);
    expect(collapsed.status).toBe(200);
    expect(collapsed.body.hrCollapsed).toBe(true);
    expect(collapsed.body.payrollRunId).toBeNull();
    const byAccount = (id: string) => collapsed.body.lines.filter((l: { accountId: string }) => l.accountId === id);
    expect(byAccount(salaryExpenseId)).toHaveLength(1);
    expect(Number(byAccount(salaryExpenseId)[0].debit)).toBe(9000);
    expect(Number(byAccount(employeesGroupId)[0].credit)).toBe(8700);
    expect(byAccount(emp.a.accountId)).toHaveLength(0);
    // قسط السلفة يبقى باسم صاحبها
    const advanceLine = collapsed.body.lines.find((l: { employeeAdvanceId: string | null }) => l.employeeAdvanceId);
    expect(advanceLine.employeeId).toBe(emp.a.id);
    // لا اسم موظف ولا حساب موظف في أي سطر آخر
    for (const l of collapsed.body.lines.filter((x: { employeeAdvanceId: string | null }) => !x.employeeAdvanceId)) {
      expect(l.employeeId).toBeNull();
      expect(JSON.stringify(l)).not.toContain(emp.a.name);
      expect(JSON.stringify(l)).not.toContain(emp.b.name);
    }
    expect(sum(collapsed.body.lines, "debit")).toBe(sum(full.body.lines, "debit"));
    expect(sum(collapsed.body.lines, "credit")).toBe(sum(collapsed.body.lines, "debit"));

    const list = await call("GET", `/journal-entries?companyId=${companyId}`, accountantToken);
    const listed = list.body.find((e: { id: string }) => e.id === juneEntryId);
    expect(listed.lines).toHaveLength(collapsed.body.lines.length);

    const pdf = await fetch(`${baseUrl}/api/journal-entries/${juneEntryId}/pdf`, { headers: { authorization: `Bearer ${accountantToken}` } });
    expect(pdf.status).toBe(200);
    const printed = pdfInputs.at(-1) as { lines: { accountLabel: string; description: string }[] };
    expect(printed.lines).toHaveLength(collapsed.body.lines.length);
    expect(JSON.stringify(printed)).not.toContain(emp.a.name);
    expect(JSON.stringify(printed)).not.toContain(emp.b.name);
  });

  it("the trial balance shows «ذمم الموظفين» as one total to an accountant, still balanced", async () => {
    const hr = await call("GET", `/reports/trial-balance?companyId=${companyId}`, ownerToken);
    const acct = await call("GET", `/reports/trial-balance?companyId=${companyId}`, accountantToken);
    const ids = (rows: { accountId: string }[]) => rows.map((r) => r.accountId);
    expect(ids(hr.body.rows)).toEqual(expect.arrayContaining([emp.a.accountId, emp.b.accountId]));
    expect(ids(acct.body.rows)).not.toContain(emp.a.accountId);
    expect(ids(acct.body.rows)).not.toContain(emp.b.accountId);
    const group = acct.body.rows.find((r: { accountId: string }) => r.accountId === employeesGroupId);
    expect(group.closing.credit).toBe(8700);
    expect(acct.body.balanced).toBe(true);
    expect(JSON.stringify(acct.body)).not.toContain(emp.a.name);

    const tree = await call("GET", `/reports/trial-balance-tree?companyId=${companyId}`, accountantToken);
    const text = JSON.stringify(tree.body);
    expect(text).not.toContain(emp.a.accountId);
    expect(text).not.toContain(emp.a.name);
    expect(text).toContain(employeesGroupId);
    expect(tree.body.balanced).toBe(true);
  });

  it("the balance sheet and the chart of accounts show the group without its people to an accountant", async () => {
    const bs = await call("GET", `/reports/balance-sheet?companyId=${companyId}`, accountantToken);
    expect(JSON.stringify(bs.body.assetRoots)).not.toContain(emp.a.name);
    expect(JSON.stringify(bs.body.assetRoots)).toContain(employeesGroupId);
    const bsHr = await call("GET", `/reports/balance-sheet?companyId=${companyId}`, ownerToken);
    expect(bs.body.totalAssets).toBe(bsHr.body.totalAssets);

    const coa = await call("GET", `/accounts?tree=true&companyId=${companyId}`, accountantToken);
    expect(coa.body.some((a: { id: string }) => a.id === emp.a.accountId)).toBe(false);
    expect(coa.body.find((a: { id: string }) => a.id === employeesGroupId).balance).toBe(-8700);
    const coaHr = await call("GET", `/accounts?tree=true&companyId=${companyId}`, ownerToken);
    expect(coaHr.body.some((a: { id: string }) => a.id === emp.a.accountId)).toBe(true);
  });

  it("an accountant cannot open, filter by or summarise one employee's account — only the group", async () => {
    expect((await call("GET", `/reports/account-ledger/${emp.a.accountId}?companyId=${companyId}`, accountantToken)).status).toBe(403);
    expect((await call("GET", `/journal-entries?companyId=${companyId}&accountId=${emp.a.accountId}`, accountantToken)).status).toBe(403);
    expect((await call("GET", `/reports/draft-entries-summary?companyId=${companyId}&accountId=${emp.a.accountId}`, accountantToken)).status).toBe(403);
    expect((await call("GET", `/reports/account-ledger/${emp.a.accountId}?companyId=${companyId}`, ownerToken)).status).toBe(200);

    const group = await call("GET", `/reports/account-ledger/${employeesGroupId}?companyId=${companyId}`, accountantToken);
    expect(group.status).toBe(200);
    const rows = group.body.rows.filter((r: { journalEntryId: string }) => r.journalEntryId === juneEntryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].credit).toBe(8700);
    expect(rows[0].accountId).toBe(employeesGroupId);
    expect(group.body.closingBalance).toBe(-8700);

    const expense = await call("GET", `/reports/account-ledger/${salaryExpenseId}?companyId=${companyId}`, accountantToken);
    expect(expense.body.rows.filter((r: { journalEntryId: string }) => r.journalEntryId === juneEntryId)).toHaveLength(1);
    const expenseHr = await call("GET", `/reports/account-ledger/${salaryExpenseId}?companyId=${companyId}`, ownerToken);
    expect(expenseHr.body.rows.filter((r: { journalEntryId: string }) => r.journalEntryId === juneEntryId)).toHaveLength(2);
    expect(expense.body.closingBalance).toBe(expenseHr.body.closingBalance);
  });

  it("the switchover month is the owner's alone, and audited with the sub-accounts' balance at that moment", async () => {
    expect((await call("PATCH", `/companies/${companyId}/payroll-totals-from-month`, accountantToken, { month: "2026-07" })).status).toBe(403);
    expect((await call("PATCH", `/companies/${companyId}/payroll-totals-from-month`, ownerToken, { month: "2026-7" })).status).toBe(400);
    const res = await call("PATCH", `/companies/${companyId}/payroll-totals-from-month`, ownerToken, { month: "2026-07" });
    expect(res.status, res.text).toBe(200);
    expect(res.body.payrollTotalsFromMonth).toBe("2026-07");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "company.payroll_totals_from_month_changed" } });
    expect(audit.metadata).toMatchObject({ before: null, after: "2026-07", employeeSubAccountsNet: -8700 });
  });

  it("from the switchover month, payroll posts one line per component and one net line to salaries payable", async () => {
    const entry = await postRun("2026-07");
    julyEntryId = entry.id;
    expect(entry.lines.some((l) => l.accountId === emp.a.accountId || l.accountId === emp.b.accountId)).toBe(false);
    const basic = entry.lines.filter((l) => l.accountId === salaryExpenseId);
    expect(basic).toHaveLength(1);
    expect(Number(basic[0].debit)).toBe(9000);
    expect(basic[0].employeeId).toBeNull();
    expect(basic[0].description).toBe("الراتب الأساسي");
    const net = entry.lines.filter((l) => l.accountId === payableId);
    expect(net).toHaveLength(1);
    expect(Number(net[0].credit)).toBe(8700);
    expect(net[0].employeeId).toBeNull();
    // قسط السلفة وحده باسم الموظف
    const advance = entry.lines.filter((l) => l.employeeAdvanceId);
    expect(advance).toHaveLength(1);
    expect(advance[0].employeeId).toBe(emp.a.id);
    expect(Number(advance[0].credit)).toBe(300);
    expect(entry.lines.filter((l) => l.employeeId && !l.employeeAdvanceId)).toHaveLength(0);
    expect(sum(entry.lines, "debit")).toBe(sum(entry.lines, "credit"));
    expect(entry.sourceModule).toBe("payroll");

    // لا شيء شخصي فيه يُطوى: المحاسب يرى القيد كما هو
    const acct = await call("GET", `/journal-entries/${julyEntryId}`, accountantToken);
    expect(acct.body.lines).toHaveLength(entry.lines.length);
    expect(acct.body.lines.find((l: { accountId: string }) => l.accountId === payableId).description).toBe("صافي الرواتب المستحقة");

    // صافي يونيو يبقى في الحسابات الفرعية (لم يُعد كتابته)، وصافي يوليو في «رواتب مستحقة»
    const june = await prisma.journalEntry.findUniqueOrThrow({ where: { id: juneEntryId }, include: { lines: true } });
    expect(june.lines.filter((l) => l.accountId === emp.a.accountId)).toHaveLength(1);
    const monthly = await call("GET", `/reports/comprehensive-monthly?companyId=${companyId}&month=2026-07`, ownerToken);
    expect(monthly.body.payroll.unpaid).toBe(8700);
  });

  it("a leave settlement hides the employee's name from an accountant everywhere its memo is served", async () => {
    const created = await call("POST", "/leave-settlements", ownerToken, {
      employeeId: emp.b.id, leaveStartDate: "2026-08-01", settlementType: "cash_in_service", cashLeaveDays: 5,
    });
    expect(created.status, created.text).toBe(201);
    settlementEntryId = created.body.journalEntryId;
    const disbursed = await call("POST", `/leave-settlements/${created.body.id}/disburse`, ownerToken, { method: "cash", date: new Date().toISOString() });
    expect(disbursed.status, disbursed.text).toBe(200);
    const payoutEntryId = disbursed.body.disbursementJournalEntryId;
    payoutId = payoutEntryId;

    const hr = await call("GET", `/journal-entries/${payoutEntryId}`, ownerToken);
    expect(hr.body.memo).toContain(emp.b.name);
    for (const id of [settlementEntryId, payoutEntryId]) {
      const acct = await call("GET", `/journal-entries/${id}`, accountantToken);
      expect(acct.body.hrCollapsed).toBe(true);
      expect(JSON.stringify(acct.body)).not.toContain(emp.b.name);
      expect(acct.body.lines.every((l: { employeeId: string | null }) => l.employeeId === null)).toBe(true);
    }

    // البحث باسم الموظف لا يجد قيود تسويته لدى المحاسب، ويجدها لدى الموارد البشرية
    const search = encodeURIComponent(emp.b.name);
    const acctSearch = await call("GET", `/journal-entries?companyId=${companyId}&search=${search}`, accountantToken);
    expect(acctSearch.body.map((e: { id: string }) => e.id)).not.toContain(payoutEntryId);
    const hrSearch = await call("GET", `/journal-entries?companyId=${companyId}&search=${search}`, ownerToken);
    expect(hrSearch.body.map((e: { id: string }) => e.id)).toContain(payoutEntryId);

    // لوحة المتابعة (أكبر الحركات النقدية) والأستاذ
    const top = await call("GET", `/dashboard/top-cash-transactions?companyId=${companyId}`, accountantToken);
    expect(top.status, top.text).toBe(200);
    expect(JSON.stringify(top.body)).not.toContain(emp.b.name);
    const topHr = await call("GET", `/dashboard/top-cash-transactions?companyId=${companyId}`, ownerToken);
    expect(JSON.stringify(topHr.body)).toContain(emp.b.name);
    const cashId = (await prisma.journalEntryLine.findFirstOrThrow({ where: { journalEntryId: payoutEntryId, credit: { gt: 0 } } })).accountId;
    const ledger = await call("GET", `/reports/account-ledger/${cashId}?companyId=${companyId}`, accountantToken);
    expect(JSON.stringify(ledger.body)).not.toContain(emp.b.name);

    // قيد العكس ينسخ بيان الأصل وأسطره — فيُطوى مثله
    const reversal = await call("POST", `/journal-entries/${payoutEntryId}/reverse`, ownerToken, { date: new Date().toISOString() });
    expect(reversal.status, reversal.text).toBe(201);
    const reversalAcct = await call("GET", `/journal-entries/${reversal.body.id}`, accountantToken);
    expect(JSON.stringify(reversalAcct.body)).not.toContain(emp.b.name);
    const original = await call("GET", `/journal-entries/${payoutEntryId}`, accountantToken);
    expect(JSON.stringify(original.body.reversedByEntry)).not.toContain(emp.b.name);
    const reverseAsAcct = await call("POST", `/journal-entries/${settlementEntryId}/reverse`, accountantToken, { date: new Date().toISOString() });
    expect(reverseAsAcct.status, reverseAsAcct.text).toBe(201);
    expect(JSON.stringify(reverseAsAcct.body)).not.toContain(emp.b.name);
  });

  it("a mirror of a settlement (which copies its memo), and a reversal of that mirror, hide the name too", async () => {
    const other = await call("POST", "/companies", ownerToken, { name: `شركة المرآة ${stamp}`, businessActivity: "retail" });
    expect(other.status, other.text).toBe(201);
    const cash = (await prisma.account.findFirstOrThrow({ where: { companyId: other.body.id, code: "111001" } })).id;
    const revenue = (await prisma.account.findFirstOrThrow({ where: { companyId: other.body.id, type: "revenue", isPosting: true } })).id;
    const source = await prisma.journalEntry.findUniqueOrThrow({ where: { id: payoutId }, include: { lines: true } });
    const amount = sum(source.lines, "debit");
    const mirror = await call("POST", `/journal-entries/${payoutId}/mirror`, ownerToken, {
      targetCompanyId: other.body.id, date: source.date.toISOString(), memo: source.memo,
      lines: [{ accountId: cash, debit: amount, credit: 0 }, { accountId: revenue, debit: 0, credit: amount }],
    });
    expect(mirror.status, mirror.text).toBe(201);
    expect(mirror.body.memo).toContain(emp.b.name);

    const mirrorAcct = await call("GET", `/journal-entries/${mirror.body.id}`, accountantToken);
    expect(JSON.stringify(mirrorAcct.body)).not.toContain(emp.b.name);
    const listed = await call("GET", `/journal-entries?companyId=${other.body.id}`, accountantToken);
    expect(JSON.stringify(listed.body)).not.toContain(emp.b.name);
    const sourceAcct = await call("GET", `/journal-entries/${payoutId}`, accountantToken);
    expect(JSON.stringify(sourceAcct.body.mirrorEntry)).not.toContain(emp.b.name);

    const reversal = await call("POST", `/journal-entries/${mirror.body.id}/reverse`, ownerToken, { date: new Date().toISOString() });
    expect(reversal.status, reversal.text).toBe(201);
    expect(JSON.stringify((await call("GET", `/journal-entries/${reversal.body.id}`, accountantToken)).body)).not.toContain(emp.b.name);
    expect((await call("GET", `/journal-entries/${reversal.body.id}`, ownerToken)).body.memo).toContain(emp.b.name);
  });

  it("an accountant cannot save over an un-posted payroll or settlement entry from its collapsed view", async () => {
    expect((await call("POST", `/journal-entries/${juneEntryId}/unpost`, ownerToken, { pin: PIN })).status).toBe(200);
    const collapsed = await call("GET", `/journal-entries/${juneEntryId}`, accountantToken);
    const res = await call("PATCH", `/journal-entries/${juneEntryId}`, accountantToken, {
      companyId, date: collapsed.body.date, memo: collapsed.body.memo,
      lines: collapsed.body.lines.map((l: { accountId: string; debit: string; credit: string }) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })),
    });
    expect(res.status, res.text).toBe(403);
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: juneEntryId }, include: { lines: true } });
    expect(entry.lines.filter((l) => l.accountId === emp.a.accountId)).toHaveLength(1);
    expect((await call("POST", `/journal-entries/${juneEntryId}/post`, ownerToken)).status).toBe(200);
  });

  it("an advance keeps its employee's name for everyone where it is posted", async () => {
    const advanceEntry = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId, memo: { contains: "سلفة" } } });
    const acct = await call("GET", `/journal-entries/${advanceEntry.id}`, accountantToken);
    expect(acct.body.memo).toContain(emp.a.name);
    expect(acct.body.hrCollapsed).toBeUndefined();
  });

  it("employee, payroll-run and leave-settlement attachments are for HR roles only — listing, uploading and deleting", async () => {
    const run = await prisma.payrollRun.findFirstOrThrow({ where: { tenantId } });
    const settlement = await prisma.leaveSettlement.findFirstOrThrow({ where: { tenantId } });
    const targets: [string, string][] = [["employee", emp.a.id], ["payroll_run", run.id], ["leave_settlement", settlement.id]];
    for (const [entityType, entityId] of targets) {
      const file = await prisma.attachment.create({
        data: { tenantId, entityType, entityId, fileName: `عقد ${emp.a.name}.pdf`, fileKey: `test/${stamp}/${entityType}`, fileSize: 10, mimeType: "application/pdf" },
      });
      const listed = await call("GET", `/attachments?entityType=${entityType}&entityId=${entityId}`, accountantToken);
      expect(listed.status, `${entityType}: ${listed.text}`).toBe(403);
      expect(listed.text).not.toContain(emp.a.name);
      expect((await call("DELETE", `/attachments/${file.id}`, accountantToken)).status).toBe(403);
      expect(await prisma.attachment.count({ where: { id: file.id } })).toBe(1);
      const upload = new FormData();
      upload.append("entityType", entityType);
      upload.append("entityId", entityId);
      upload.append("file", new Blob(["x"], { type: "application/pdf" }), "x.pdf");
      const uploaded = await fetch(`${baseUrl}/api/attachments`, { method: "POST", headers: { authorization: `Bearer ${accountantToken}` }, body: upload });
      expect(uploaded.status).toBe(403);
      expect((await call("GET", `/attachments?entityType=${entityType}&entityId=${entityId}`, ownerToken)).status).not.toBe(403);
    }
    // مرفقات القيود اليومية كما هي لغير الموارد البشرية
    expect((await call("GET", `/attachments?entityType=journal_entry&entityId=${julyEntryId}`, accountantToken)).status).toBe(200);
  });

  it("only HR roles can change which groups collapse", async () => {
    expect((await call("PATCH", `/accounts/${employeesGroupId}`, accountantToken, { isPersonalGroup: false })).status).toBe(403);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: employeesGroupId } })).isPersonalGroup).toBe(true);
  });
});
