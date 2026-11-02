import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { hashPassword } from "../../lib/password";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { backfillSystemPayrollComponents } from "../../lib/payrollComponentsBackfill";

/**
 * ترحيل الرواتب بالإجماليات مع تحميل التكلفة (قرار المالك 2026-11-01) عبر HTTP الحقيقي على Postgres:
 * - 14 موظفاً في قسمين ومركزي تكلفة + موظفان بلا تخصيص كامل، بتأمينات (9.75% و10.75%) وسلف بأقساط وغياب وجزاءات
 *   واستقطاعات. البنود النظامية من كود التعبئة نفسه (backfillSystemPayrollComponents) كما في الإنتاج.
 * - الإضافات مجمّعة بـ(الحساب، القسم، المركز)؛ الغياب/الجزاءات/الاستقطاعات تخفّض مصروف الأساسي بقسم الموظف؛ التأمينات
 *   على «تأمينات اجتماعية مستحقة»؛ الصافي كله سطر واحد على «رواتب مستحقة»؛ لا سطر غيره على ذلك الحساب؛ توازن للهللة.
 * - غير المخصَّص مجموعة «غير مخصص» صريحة، لا «المالية والحسابات»؛ والمسودة تحذّر بأسمائهم.
 * - قبل شهر التحويل: سطر لكل موظف كما كان، والصافي على حسابه الفرعي، ولا خصم على «رواتب مستحقة».
 * - مساهمة صاحب العمل مطفأة افتراضياً، وتشغيلها يضيف مدين مصروف/دائن التزام دون تغيير الصافي.
 * - المرآة والعكس (CLAUDE.md 1): العكس ينسخ التخصيص ويعكس الصافي وحده على «رواتب مستحقة»؛ قيد رواتب بأقساط سلف
 *   لا يُعكَس (يُفَكّ ترحيله)؛ الكشف لا يُفَك ترحيله وقيده معكوس أو له مرآة؛ اقتراح المرآة لا ينقل تخصيص الشركة الأصل.
 * - فك ترحيل كشف رُحِّل بالطريقة القديمة ثم إعادة ترحيله بعد التحويل (سيناريو J02074) يُنتج أسطر الطريقة الجديدة
 *   ويعيد أرصدة السلف ثم يخصمها مرة واحدة.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `payroll-alloc-${stamp}@example.com`;
const PIN = "4417";
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let otherCompanyId = "";
const ids = { deptA: "", deptB: "", ccA: "", ccB: "", netPayable: "", gosiPayable: "", advanceAccount: "" };
const comp: Record<string, string> = {};
const emps: { id: string; name: string; accountId: string; alloc: "A" | "B" | "none" | "deptOnly" }[] = [];
const advances: { id: string; employeeId: string }[] = [];

async function call(method: string, path: string, body?: unknown) {
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

type Line = { accountId: string; debit: unknown; credit: unknown; department: string | null; departmentId: string | null; costCenterId: string | null; employeeId: string | null; employeeAdvanceId: string | null; description: string | null };
const cents = (v: unknown) => Math.round(Number(v) * 100);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function entryOf(journalEntryId: string) {
  return prisma.journalEntry.findUniqueOrThrow({ where: { id: journalEntryId }, include: { lines: true } });
}

async function createRun(month: string) {
  const run = await call("POST", "/payroll-runs", { companyId, month, employeeIds: emps.map((e) => e.id) });
  expect(run.status, run.text).toBe(201);
  return run.body.id as string;
}

async function post(runId: string) {
  const posted = await call("POST", `/payroll-runs/${runId}/post`);
  expect(posted.status, posted.text).toBe(200);
  return entryOf(posted.body.journalEntryId);
}

/** القيد المتوقَّع من صفوف الكشف (مُخرَج النظام) وتخصيص كل موظف — بقواعد التوجيه المكتوبة صراحة هنا */
function expectedTotalsGroups(rows: { employeeId: string; componentValues: Record<string, number> }[], columns: { id: string; systemKey: string | null; kind: string }[], accountOf: Map<string, string>, advanceComponentIds: Set<string>) {
  const groups = new Map<string, number>();
  const add = (key: string, v: number) => groups.set(key, (groups.get(key) || 0) + v);
  const allocOf = (employeeId: string) => {
    const e = emps.find((x) => x.id === employeeId)!;
    if (e.alloc === "A") return `${ids.deptA}|${ids.ccA}`;
    if (e.alloc === "B") return `${ids.deptB}|${ids.ccB}`;
    if (e.alloc === "deptOnly") return `${ids.deptA}|`;
    return "|";
  };
  for (const row of rows) {
    for (const [componentId, value] of Object.entries(row.componentValues)) {
      if (!value || advanceComponentIds.has(componentId)) continue;
      const col = columns.find((c) => c.id === componentId)!;
      if (col.kind === "addition") add(`${accountOf.get(componentId)}|D|${allocOf(row.employeeId)}`, value);
      else if (["absence", "otherDed", "penalty"].includes(col.systemKey || "")) add(`${accountOf.get(comp.basic)}|C|${allocOf(row.employeeId)}`, value);
      else add(`${accountOf.get(componentId)}|C||`, value);
    }
  }
  return new Map([...groups].map(([k, v]) => [k, round2(v)]));
}

describe("payroll totals posting with cost allocation (integration)", () => {
  let novemberRunId = "";
  let novemberEntry: Awaited<ReturnType<typeof entryOf>>;
  let octoberRunId = "";
  let octoberEntry: Awaited<ReturnType<typeof entryOf>>;
  const accountOf = new Map<string, string>();
  const advanceComponentIds = new Set<string>();

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `تحميل الرواتب ${stamp}`, businessActivity: "manufacturing", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const other = await call("POST", "/companies", { name: `شركة شقيقة ${stamp}` });
    expect(other.status, other.text).toBe(201);
    otherCompanyId = other.body.id;

    ids.deptA = (await call("POST", "/departments", { name: "الإنتاج", companyId })).body.id;
    ids.deptB = (await call("POST", "/departments", { name: "المبيعات", companyId })).body.id;
    ids.ccA = (await call("POST", "/cost-centers", { name: "المصنع", companyId })).body.id;
    ids.ccB = (await call("POST", "/cost-centers", { name: "المعرض", companyId })).body.id;
    expect([ids.deptA, ids.deptB, ids.ccA, ids.ccB].every(Boolean)).toBe(true);

    const spec: [string, "A" | "B" | "none" | "deptOnly", number, number, number, number | null, number][] = [
      // اسم، تخصيص، أساسي، سكن، نقل، نسبة التأمينات (null = غير مشمول)، استقطاعات أخرى ثابتة
      ["أ1", "A", 4000, 1000, 400, 9.75, 0], ["أ2", "A", 5333.33, 1333.33, 500, 9.75, 0], ["أ3", "A", 7000, 1750, 0, 10.75, 0],
      ["أ4", "A", 3000, 750, 300, null, 0], ["أ5", "A", 2500, 625, 250, null, 0], ["أ6", "A", 1800, 450, 200, null, 150],
      ["ب1", "B", 6000, 1500, 600, 9.75, 0], ["ب2", "B", 4500, 1125, 450, 9.75, 1610], ["ب3", "B", 3200, 800, 320, null, 0],
      ["ب4", "B", 2800, 700, 280, null, 0], ["ب5", "B", 2200, 550, 220, null, 0], ["ب6", "B", 3900, 975, 390, null, 0],
      ["ج1", "none", 2000, 500, 200, null, 0], ["ج2", "deptOnly", 4100, 1025, 410, 9.75, 0],
    ];
    for (const [short, alloc, basic, housing, transport, gosi, otherDed] of spec) {
      const name = `موظف ${short} ${stamp}`;
      const res = await call("POST", "/employees", {
        companyId, name, hireDate: "2024-01-01", basicSalary: basic, housingAllowance: housing, transportAllowance: transport,
        gosiApplicable: gosi != null, gosiEmployeeRate: gosi, otherDeductions: otherDed,
        departmentId: alloc === "A" || alloc === "deptOnly" ? ids.deptA : alloc === "B" ? ids.deptB : null,
        costCenterId: alloc === "A" ? ids.ccA : alloc === "B" ? ids.ccB : null,
      });
      expect(res.status, res.text).toBe(201);
      emps.push({ id: res.body.id, name, accountId: res.body.accountId, alloc });
    }

    await backfillSystemPayrollComponents(prisma, tenantId, companyId);
    const components = await prisma.payrollComponent.findMany({ where: { companyId } });
    for (const c of components) { if (c.systemKey) comp[c.systemKey] = c.id; accountOf.set(c.id, c.accountId); }
    ids.netPayable = (await prisma.account.findFirstOrThrow({ where: { companyId, name: "رواتب مستحقة", isPosting: true } })).id;
    ids.gosiPayable = accountOf.get(comp.gosi)!;
    ids.advanceAccount = (await prisma.account.findFirstOrThrow({ where: { companyId, name: "سلف وقروض الموظفين", isPosting: true } })).id;

    // سلفتان بقسط شهري (أ5: 500 من 2000؛ ب4: 400 من 1000)
    for (const [index, amount, installment] of [[4, 2000, 500], [9, 1000, 400]] as const) {
      const adv = await call("POST", "/employee-advances", { companyId, employeeId: emps[index].id, accountId: ids.advanceAccount, amount, monthlyInstallment: installment, startDate: "2026-09-01" });
      expect(adv.status, adv.text).toBe(201);
      advances.push({ id: adv.body.id, employeeId: emps[index].id });
    }
    for (const c of await prisma.payrollComponent.findMany({ where: { companyId } })) {
      accountOf.set(c.id, c.accountId);
      if (c.name.startsWith("قسط سلفة")) advanceComponentIds.add(c.id);
    }

    // تسويات شهرية: غياب يومين لـ ب1 ويوم لـ ب6، جزاء 120 لـ ب3 — لشهري أكتوبر ونوفمبر
    for (const month of ["2026-10", "2026-11"]) {
      for (const [employeeIndex, componentKey, value] of [[6, "absence", 2], [11, "absence", 1], [8, "penalty", 120]] as const) {
        const action = await call("POST", "/hr-actions", { employeeIds: [emps[employeeIndex].id], month, componentId: comp[componentKey], value });
        expect(action.status, action.text).toBeLessThan(300);
      }
    }

    // أكتوبر بالطريقة القديمة (قبل شهر التحويل)، ثم التحويل من نوفمبر
    octoberRunId = await createRun("2026-10");
    octoberEntry = await post(octoberRunId);
    const sw = await call("PATCH", `/companies/${companyId}/payroll-totals-from-month`, { month: "2026-11" });
    expect(sw.status, sw.text).toBe(200);
    novemberRunId = await createRun("2026-11");
  }, 240_000);

  afterAll(async () => {
    server?.close();
    await prisma.payrollRun.deleteMany({ where: { tenantId } });
    await prisma.employeeAdvanceDeduction.deleteMany({ where: { employeeAdvance: { tenantId } } });
    await prisma.employeeAdvance.deleteMany({ where: { tenantId } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("the draft warns about employees without a department or cost center, by name", async () => {
    const rows = await call("GET", `/payroll-runs/${novemberRunId}/rows`);
    expect(rows.status, rows.text).toBe(200);
    const warned = rows.body.warnings.unallocatedEmployees;
    expect(warned.map((w: { name: string }) => w.name).sort()).toEqual([emps[12].name, emps[13].name].sort());
    expect(warned.find((w: { employeeId: string }) => w.employeeId === emps[13].id)).toMatchObject({ missingDepartment: false, missingCostCenter: true });
    expect(warned.find((w: { employeeId: string }) => w.employeeId === emps[12].id)).toMatchObject({ missingDepartment: true, missingCostCenter: true });
  });

  it("totals mode groups lines by account, department and cost center, and credits the whole net to «رواتب مستحقة»", async () => {
    const rows = await call("GET", `/payroll-runs/${novemberRunId}/rows`);
    novemberEntry = await post(novemberRunId);
    const lines = novemberEntry.lines as unknown as Line[];

    // توازن للهللة
    expect(lines.reduce((s, l) => s + cents(l.debit), 0)).toBe(lines.reduce((s, l) => s + cents(l.credit), 0));

    // كل سطر غير السلف = مجموعة متوقعة واحدة بمبلغها
    const expected = expectedTotalsGroups(rows.body.rows, rows.body.columns, accountOf, advanceComponentIds);
    const grouped = lines.filter((l) => !l.employeeAdvanceId && l.accountId !== ids.netPayable);
    const actual = new Map(grouped.map((l) => [`${l.accountId}|${cents(l.debit) ? "D" : "C"}|${l.departmentId ?? ""}|${l.costCenterId ?? ""}`, Number(l.debit) || Number(l.credit)]));
    expect(actual).toEqual(expected);
    expect(grouped.length).toBe(expected.size);
    for (const l of grouped) expect(l.employeeId).toBeNull();

    // الغياب والجزاء والاستقطاعات خصم من مصروف الأساسي بقسم الموظف — ب1/ب6 غياب وب3 جزاء وب2 استقطاع: كلها في B
    const basicAccount = accountOf.get(comp.basic)!;
    const reductionB = grouped.find((l) => l.accountId === basicAccount && cents(l.credit) && l.departmentId === ids.deptB)!;
    const rowsB = rows.body.rows.filter((r: { employeeId: string }) => emps.find((e) => e.id === r.employeeId)!.alloc === "B");
    const sumKey = (rs: { componentValues: Record<string, number> }[], key: string) => rs.reduce((s, r) => s + (r.componentValues[comp[key]] || 0), 0);
    expect(Number(reductionB.credit)).toBe(round2(sumKey(rowsB, "absence") + sumKey(rowsB, "penalty") + sumKey(rowsB, "otherDed")));
    expect(reductionB.costCenterId).toBe(ids.ccB);
    expect(reductionB.description).toContain("خصم الغياب");

    // التأمينات على «تأمينات اجتماعية مستحقة» بمجموع حصص الموظفين، بلا تخصيص
    const gosi = grouped.filter((l) => l.accountId === ids.gosiPayable);
    expect(gosi).toHaveLength(1);
    expect(Number(gosi[0].credit)).toBe(round2(sumKey(rows.body.rows, "gosi")));
    expect(gosi[0].departmentId).toBeNull();

    // غير المخصَّص: مجموعة «غير مخصص» صريحة؛ لا «المالية والحسابات» في أي سطر
    const unassigned = grouped.filter((l) => l.department === "غير مخصص");
    expect(unassigned.length).toBeGreaterThan(0);
    for (const l of unassigned) { expect(l.departmentId).toBeNull(); expect(l.costCenterId).toBeNull(); }
    expect(grouped.some((l) => l.departmentId === ids.deptA && l.costCenterId === null)).toBe(true); // ج2: قسم بلا مركز
    expect(lines.some((l) => l.department === "المالية والحسابات")).toBe(false);

    // أقساط السلف: سطر لكل موظف وسلفة
    const advanceLines = lines.filter((l) => l.employeeAdvanceId);
    expect(advanceLines.map((l) => [l.employeeId, l.employeeAdvanceId, Number(l.credit)]).sort()).toEqual(
      [[advances[0].employeeId, advances[0].id, 500], [advances[1].employeeId, advances[1].id, 400]].sort(),
    );
    for (const l of advanceLines) expect(l.accountId).toBe(ids.advanceAccount);

    // «رواتب مستحقة»: سطر الصافي وحده، دائن بمجموع صافي الكشف
    const onNet = lines.filter((l) => l.accountId === ids.netPayable);
    expect(onNet).toHaveLength(1);
    expect(onNet[0].description).toBe("صافي الرواتب المستحقة");
    expect(Math.abs(Number(onNet[0].credit) - rows.body.totals.net)).toBeLessThanOrEqual(0.05);
  });

  it("before the switchover month, posting stays per employee — and no deduction lands on «رواتب مستحقة»", async () => {
    const lines = octoberEntry.lines as unknown as Line[];
    expect(lines.reduce((s, l) => s + cents(l.debit), 0)).toBe(lines.reduce((s, l) => s + cents(l.credit), 0));
    expect(lines.every((l) => l.employeeId)).toBe(true);
    expect(lines.some((l) => l.accountId === ids.netPayable)).toBe(false);
    // صافي كل موظف على حسابه الفرعي
    for (const e of emps) {
      const own = lines.filter((l) => l.employeeId === e.id);
      const net = own.filter((l) => l.accountId === e.accountId);
      expect(net).toHaveLength(1);
      expect(cents(net[0].credit)).toBe(own.filter((l) => l.accountId !== e.accountId).reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0));
    }
    // استقطاع ب2 (1,610) يخفّض مصروف أساسيّه في قسمه — لا التزاماً
    const b2 = lines.find((l) => l.employeeId === emps[7].id && cents(l.credit) === 161000)!;
    expect(b2.accountId).toBe(accountOf.get(comp.basic));
    expect(b2.departmentId).toBe(ids.deptB);
    expect(b2.costCenterId).toBe(ids.ccB);
  });

  it("refuses a custom deduction mapped to «رواتب مستحقة», naming the component", async () => {
    const bad = await call("POST", `/companies/${companyId}/payroll-components`, { name: "خصم مربوط خطأً", kind: "deduction", accountId: ids.netPayable, calcMethod: "fixed", appliesByDefault: false });
    expect(bad.status, bad.text).toBe(201);
    const set = await call("PUT", `/employees/${emps[0].id}/payroll-components`, [{ componentId: bad.body.id, fixedValue: 50, isActive: true }]);
    expect(set.status, set.text).toBeLessThan(300);
    const runId = await createRun("2026-12");
    const res = await call("POST", `/payroll-runs/${runId}/post`);
    expect(res.status).toBe(400);
    expect(res.body.message ?? res.text).toContain("خصم مربوط خطأً");
    await call("PUT", `/employees/${emps[0].id}/payroll-components`, [{ componentId: bad.body.id, fixedValue: null, isActive: false }]);
    expect((await call("DELETE", `/payroll-runs/${runId}`)).status).toBe(200);
  });

  it("violations cannot post until employee receivable accounts exist — never to «رواتب مستحقة»", async () => {
    const action = await call("POST", "/hr-actions", { employeeIds: [emps[0].id], month: "2027-01", componentId: comp.violation, value: 75 });
    expect(action.status, action.text).toBeLessThan(300);
    const runId = await createRun("2027-01");
    const res = await call("POST", `/payroll-runs/${runId}/post`);
    expect(res.status).toBe(400);
    expect(res.text).toContain("خصم مخالفات");
    await prisma.hrAction.deleteMany({ where: { employeeId: emps[0].id, month: "2027-01" } });
    expect((await call("DELETE", `/payroll-runs/${runId}`)).status).toBe(200);
  });

  it("employer contributions are off by default; switched on they add Dr expense / Cr liability without changing net", async () => {
    const expense = await prisma.account.findFirstOrThrow({ where: { companyId, type: "expense", isPosting: true, name: { contains: "تأمين" } } });
    const created = await call("POST", `/companies/${companyId}/payroll-components`, {
      name: "تأمينات حصة المنشأة", kind: "employer", accountId: expense.id, contraAccountId: ids.gosiPayable, calcMethod: "formula", appliesByDefault: false,
      formula: { terms: [{ quantity: 0.1175, unitType: null, reference: { kind: "component", componentId: comp.basic } }, { quantity: 0.1175, unitType: null, reference: { kind: "component", componentId: comp.housing } }] },
    });
    expect(created.status, created.text).toBe(201);
    const missingContra = await call("POST", `/companies/${companyId}/payroll-components`, { name: "بلا التزام", kind: "employer", accountId: expense.id, calcMethod: "fixed" });
    expect(missingContra.status).toBe(400);
    const saudis = [0, 1, 2, 6, 7, 13];
    for (const i of saudis) {
      const r = await call("PUT", `/employees/${emps[i].id}/payroll-components`, [{ componentId: created.body.id, isActive: true }]);
      expect(r.status, r.text).toBeLessThan(300);
    }

    const offRun = await createRun("2027-02");
    const offRows = await call("GET", `/payroll-runs/${offRun}/rows`);
    expect(offRows.body.columns.some((c: { id: string }) => c.id === created.body.id)).toBe(false);
    const offEntry = await post(offRun);
    expect(offEntry.lines.some((l) => l.accountId === expense.id)).toBe(false);
    const offNet = Number(offEntry.lines.find((l) => l.accountId === ids.netPayable)!.credit);
    await call("POST", `/payroll-runs/${offRun}/unpost`, { pin: PIN });

    const toggled = await call("PATCH", `/companies/${companyId}/payroll-settings`, { employerContributionsEnabled: true });
    expect(toggled.status, toggled.text).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "payroll_settings.employer_contributions_changed" } });
    expect(audit.metadata).toMatchObject({ before: false, after: true });

    const onRows = await call("GET", `/payroll-runs/${offRun}/rows`);
    const employerTotal = onRows.body.totals.byComponent[created.body.id];
    expect(employerTotal).toBeGreaterThan(0);
    const onEntry = await post(offRun);
    const lines = onEntry.lines as unknown as Line[];
    expect(lines.reduce((s, l) => s + cents(l.debit), 0)).toBe(lines.reduce((s, l) => s + cents(l.credit), 0));
    expect(Number(lines.find((l) => l.accountId === ids.netPayable)!.credit)).toBe(offNet);
    const employerDebits = lines.filter((l) => l.accountId === expense.id);
    expect(round2(employerDebits.reduce((s, l) => s + Number(l.debit), 0))).toBeCloseTo(employerTotal, 1);
    expect(new Set(employerDebits.map((l) => l.department))).toEqual(new Set(["الإنتاج", "المبيعات"]));
    const gosiCredit = lines.filter((l) => l.accountId === ids.gosiPayable).reduce((s, l) => s + Number(l.credit), 0);
    expect(round2(gosiCredit)).toBeCloseTo(onRows.body.totals.byComponent[comp.gosi] + employerTotal, 1);

    await call("POST", `/payroll-runs/${offRun}/unpost`, { pin: PIN });
    await call("PATCH", `/companies/${companyId}/payroll-settings`, { employerContributionsEnabled: false });
    expect((await call("DELETE", `/payroll-runs/${offRun}`)).status).toBe(200);
  });

  describe("mirror and reversal (CLAUDE.md rule 1)", () => {
    it("a payroll entry that deducted advance installments cannot be reversed — it is unposted instead", async () => {
      const res = await call("POST", `/journal-entries/${novemberEntry.id}/reverse`, { date: "2026-11-30" });
      expect(res.status).toBe(400);
      expect(res.text).toContain("فك ترحيل الكشف");
    });

    it("a reversal of a payroll entry without advances keeps the allocation and reverses only the net on «رواتب مستحقة»", async () => {
      // كشف لموظفي القسم B بلا سلفة ب4
      const ids2 = emps.filter((e, i) => e.alloc === "B" && i !== 9).map((e) => e.id);
      const run = await call("POST", "/payroll-runs", { companyId, month: "2027-03", employeeIds: ids2 });
      const entry = await post(run.body.id);
      const reversal = await call("POST", `/journal-entries/${entry.id}/reverse`, { date: "2027-03-29" });
      expect(reversal.status, reversal.text).toBe(201);
      const rLines = (await entryOf(reversal.body.id)).lines as unknown as Line[];
      const key = (l: Line) => `${l.accountId}|${l.departmentId}|${l.costCenterId}|${l.department}`;
      expect(rLines.map(key).sort()).toEqual((entry.lines as unknown as Line[]).map(key).sort());
      for (const l of rLines) {
        const original = (entry.lines as unknown as Line[]).find((o) => key(o) === key(l) && cents(o.debit) === cents(l.credit))!;
        expect(original).toBeTruthy();
      }
      const onNet = rLines.filter((l) => l.accountId === ids.netPayable);
      expect(onNet).toHaveLength(1);
      expect(cents(onNet[0].debit)).toBeGreaterThan(0);

      // الكشف لا يُفَك ترحيله وقيده معكوس — يكرّر الأثر
      const unpost = await call("POST", `/payroll-runs/${run.body.id}/unpost`, { pin: PIN });
      expect(unpost.status).toBe(400);
      expect(unpost.text).toContain("معكوس");
    });

    it("a mirror suggestion does not carry the origin company's allocation, and a mirrored run cannot be unposted", async () => {
      const ids3 = emps.filter((e) => e.alloc === "A" && e.id !== advances[0].employeeId).map((e) => e.id);
      const run = await call("POST", "/payroll-runs", { companyId, month: "2027-04", employeeIds: ids3 });
      const entry = await post(run.body.id);
      // مجموعة «الذمم المدينة الأخرى» (113000000) كما في شجرة أرمي — شرط اقتراح المرآة؛ قوالب التسجيل لا تحملها
      for (const c of [companyId, otherCompanyId]) {
        await prisma.account.create({ data: { tenantId, companyId: c, code: "113000000", name: "الذمم المدينة الأخرى", type: "asset", level: 3, isPosting: false } });
      }
      const suggestion = await call("POST", `/journal-entries/${entry.id}/mirror-suggestion`, { targetCompanyId: otherCompanyId });
      expect(suggestion.status, suggestion.text).toBe(200);
      for (const l of suggestion.body.lines) {
        expect(l.costCenterId ?? null).toBeNull();
        expect(l.departmentId ?? null).toBeNull();
      }
      const targetAccounts = await prisma.account.findMany({ where: { companyId: otherCompanyId, isPosting: true }, take: 2, orderBy: { code: "asc" } });
      const mirror = await call("POST", `/journal-entries/${entry.id}/mirror`, {
        targetCompanyId: otherCompanyId, date: "2027-04-28",
        lines: [{ accountId: targetAccounts[0].id, debit: 100, credit: 0 }, { accountId: targetAccounts[1].id, debit: 0, credit: 100 }],
      });
      expect(mirror.status, mirror.text).toBe(201);
      const mirrorLines = (await entryOf(mirror.body.id)).lines;
      expect(mirrorLines.every((l) => l.costCenterId === null && l.departmentId === null)).toBe(true);

      const unpost = await call("POST", `/payroll-runs/${run.body.id}/unpost`, { pin: PIN });
      expect(unpost.status).toBe(400);
      expect(unpost.text).toContain("مرآة");
      // عكس قيد المرآة لا يمسّ الكشف ولا قيده الأصلي
      const reversedMirror = await call("POST", `/journal-entries/${mirror.body.id}/reverse`, { date: "2027-04-29" });
      expect(reversedMirror.status, reversedMirror.text).toBe(201);
      expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.body.id } })).status).toBe("posted");
      expect((await entryOf(entry.id)).lines).toHaveLength(entry.lines.length);
    });
  });

  it("unposting a run posted the old way and reposting it after the switchover yields the new lines, deducting advances once (J02074)", async () => {
    const balances = async () => Object.fromEntries((await prisma.employeeAdvance.findMany({ where: { id: { in: advances.map((a) => a.id) } } })).map((a) => [a.id, Number(a.remainingBalance)]));
    const afterBoth = await balances(); // أكتوبر ونوفمبر خصما قسطاً لكلٍّ
    expect(afterBoth).toEqual({ [advances[0].id]: 1000, [advances[1].id]: 200 });

    const unpost = await call("POST", `/payroll-runs/${octoberRunId}/unpost`, { pin: PIN });
    expect(unpost.status, unpost.text).toBe(200);
    expect(await balances()).toEqual({ [advances[0].id]: 1500, [advances[1].id]: 600 });
    expect(await prisma.journalEntry.findUnique({ where: { id: octoberEntry.id } })).toBeNull();

    // المالك يقدّم شهر التحويل إلى أكتوبر ثم يعيد الترحيل
    expect((await call("PATCH", `/companies/${companyId}/payroll-totals-from-month`, { month: "2026-10" })).status).toBe(200);
    const reposted = await post(octoberRunId);
    const lines = reposted.lines as unknown as Line[];
    expect(lines.reduce((s, l) => s + cents(l.debit), 0)).toBe(lines.reduce((s, l) => s + cents(l.credit), 0));
    expect(lines.filter((l) => l.accountId === ids.netPayable)).toHaveLength(1);
    expect(lines.filter((l) => !l.employeeAdvanceId && l.employeeId)).toHaveLength(0);
    expect(lines.some((l) => emps.some((e) => e.accountId === l.accountId))).toBe(false);
    expect(lines.filter((l) => l.employeeAdvanceId)).toHaveLength(2);
    expect(await balances()).toEqual(afterBoth);
    expect(await prisma.employeeAdvanceDeduction.count({ where: { payrollRunId: octoberRunId } })).toBe(2);

    // نفس شكل أسطر نوفمبر (نفس الموظفين والتسويات)
    const shape = (ls: Line[]) => ls.map((l) => `${l.accountId}|${l.departmentId}|${l.costCenterId}|${cents(l.debit) ? "D" : "C"}|${l.employeeAdvanceId ?? ""}`).sort();
    expect(shape(lines)).toEqual(shape(novemberEntry.lines as unknown as Line[]));
  });
});
