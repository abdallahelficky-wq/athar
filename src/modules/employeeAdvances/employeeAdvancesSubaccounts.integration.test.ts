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
 * حسابات ذمم الموظفين الفرعية وأقساط السلف (قرار المالك 2026-11-01) عبر HTTP الحقيقي على Postgres:
 * - مجموعة الأب في إعدادات الرواتب: أصول، غير ترحيلية، من الشركة نفسها — وإلا رُفضت.
 * - سلفة جديدة تُقيَّد مدينة على حساب الموظف الفرعي (يُنشأ أول مرة باسمه ويُعاد استخدامه)؛ القسط دائن عليه.
 * - كل مسودة كشف تُدخل قسط كل سلفة نشطة: الأقل بين (القسط، الرصيد، صافي الموظف قبل القسط)؛ بلا قسط = «تحتاج قسطاً» ولا خصم؛
 *   بند قسط قديم (Phase E) لا يُخصَم مرتين؛ تجاوز النسبة القصوى تحذير فقط.
 * - تأجيل القسط هذا الشهر: صفر في هذا الكشف وحده، سبب إلزامي، مستخدم ووقت، تدقيق، تراجع ما دام مسودة؛ الشهر التالي يعيده.
 * - المخالفات دائنة حساب ذمة الموظف نفسه.
 * - فك الترحيل يعيد الأرصدة ويُبقي التأجيل مع المسودة، وإعادة الترحيل تحترمه.
 * - معاينة إعادة التصنيف: قيد غير مرحَّل، ومطابقة الدفتر مقابل الأرصدة لكل حساب ولكل موظف، ولا كتابة.
 * - المرآة والعكس (CLAUDE.md 1): قيد صرف سلفة لا يُعكَس؛ قيد رواتب بأقساط لا يُعكَس؛ المرآة لا تقبل حساب ذمة موظف ولا سلفة
 *   من الشركة الأصل؛ عكس قيد مرآة لا يمسّ أرصدة السلف ولا تأجيلاتها.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `advances-sub-${stamp}@example.com`;
const PIN = "5528";
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let otherCompanyId = "";
let sharedAdvanceAccount = "";
let parentGroupId = "";
const comp: Record<string, string> = {};
const emp: Record<"a1" | "a2" | "a3" | "a4", { id: string; name: string }> = {} as never;
const adv: Record<"old1" | "old2" | "old3" | "new4a" | "new4b", string> = {} as never;

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

const cents = (v: unknown) => Math.round(Number(v) * 100);
const balanceOf = async (id: string) => Number((await prisma.employeeAdvance.findUniqueOrThrow({ where: { id } })).remainingBalance);
const rowsOf = async (runId: string) => (await call("GET", `/payroll-runs/${runId}/rows`)).body;
const installment = (rows: any, employeeId: string, advanceId: string) =>
  rows.rows.find((r: any) => r.employeeId === employeeId).advanceInstallments.find((i: any) => i.advanceId === advanceId);

describe("employee receivable sub-accounts and advance installments (integration)", () => {
  let runId = "";

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `سلف فرعية ${stamp}`, businessActivity: "manufacturing", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    otherCompanyId = (await call("POST", "/companies", { name: `شقيقة ${stamp}` })).body.id;

    const dept = (await call("POST", "/departments", { name: "التشغيل", companyId })).body.id;
    const cc = (await call("POST", "/cost-centers", { name: "المصنع", companyId })).body.id;
    for (const [key, basic] of [["a1", 5000], ["a2", 3000], ["a3", 2000], ["a4", 4000]] as const) {
      const name = `موظف ${key} ${stamp}`;
      const res = await call("POST", "/employees", { companyId, name, hireDate: "2024-01-01", basicSalary: basic, departmentId: dept, costCenterId: cc });
      expect(res.status, res.text).toBe(201);
      emp[key] = { id: res.body.id, name };
    }
    await backfillSystemPayrollComponents(prisma, tenantId, companyId);
    for (const c of await prisma.payrollComponent.findMany({ where: { companyId } })) if (c.systemKey) comp[c.systemKey] = c.id;
    sharedAdvanceAccount = (await prisma.account.findFirstOrThrow({ where: { companyId, name: "سلف وقروض الموظفين", isPosting: true } })).id;

    // سلف قائمة قبل اختيار المجموعة — على الحساب المشترك كما في الإنتاج اليوم
    for (const [key, employee, amount, monthlyInstallment] of [["old1", "a1", 3000, 1000], ["old2", "a2", 1500, undefined], ["old3", "a3", 5000, 2500]] as const) {
      const res = await call("POST", "/employee-advances", { companyId, employeeId: emp[employee].id, accountId: sharedAdvanceAccount, amount, monthlyInstallment, startDate: "2026-08-01" });
      expect(res.status, res.text).toBe(201);
      adv[key] = res.body.id;
    }
    // بيانات قديمة سابقة لهذا الترحيل (Phase E): بند رواتب لكل سلفة بقسطها — يجب ألا يُخصَم القسط مرتين
    const legacyComponent = await prisma.payrollComponent.create({
      data: { tenantId, companyId, name: `قسط سلفة — ${emp.a1.name} (2026-08-01)`, kind: "deduction", accountId: sharedAdvanceAccount, calcMethod: "fixed", allowsMonthlyAdjustments: false, prorateOnPartialMonth: false, appliesByDefault: false },
    });
    const link = await prisma.employeePayrollComponent.create({ data: { tenantId, employeeId: emp.a1.id, componentId: legacyComponent.id, fixedValue: 1000, isActive: true } });
    await prisma.employeeAdvance.update({ where: { id: adv.old1 }, data: { employeePayrollComponentId: link.id } });

    // المجموعة الأب: حساب تجميع أصول تحت «الأصول المتداولة» (11) يُنشئه المستخدم من شجرة الحسابات
    const currentAssets = await prisma.account.findFirstOrThrow({ where: { companyId, code: "11" } });
    const group = await call("POST", "/accounts", { name: "سلف وعهد الموظفين", type: "asset", companyId, parentId: currentAssets.id, isPosting: false });
    expect(group.status, group.text).toBe(201);
    parentGroupId = group.body.id;
    expect((await call("PATCH", `/companies/${companyId}/payroll-totals-from-month`, { month: "2026-11" })).status).toBe(200);
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

  it("the advances parent must be a non-posting asset group of the same company", async () => {
    const posting = await call("PATCH", `/companies/${companyId}/payroll-settings`, { advancesParentAccountId: sharedAdvanceAccount });
    expect(posting.status).toBe(400);
    const liabilityGroup = await prisma.account.findFirstOrThrow({ where: { companyId, type: "liability", isPosting: false, level: { lt: 4 } } });
    expect((await call("PATCH", `/companies/${companyId}/payroll-settings`, { advancesParentAccountId: liabilityGroup.id })).status).toBe(400);
    const foreignGroup = await prisma.account.findFirstOrThrow({ where: { companyId: otherCompanyId, type: "asset", isPosting: false, level: 3 } });
    expect((await call("PATCH", `/companies/${companyId}/payroll-settings`, { advancesParentAccountId: foreignGroup.id })).status).toBe(400);

    const ok = await call("PATCH", `/companies/${companyId}/payroll-settings`, { advancesParentAccountId: parentGroupId, maxInstallmentPercentOfGross: 20 });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.advancesParentAccountId).toBe(parentGroupId);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "payroll_settings.advances_parent_changed" } });
    expect(audit.metadata).toMatchObject({ before: null, after: parentGroupId });
  });

  it("a new advance debits the employee's own sub-account, created once under the group and reused", async () => {
    const first = await call("POST", "/employee-advances", { companyId, employeeId: emp.a4.id, amount: 1200, monthlyInstallment: 300, startDate: "2026-09-01" });
    expect(first.status, first.text).toBe(201);
    const second = await call("POST", "/employee-advances", { companyId, employeeId: emp.a4.id, amount: 600, monthlyInstallment: 200, startDate: "2026-10-01", accountId: sharedAdvanceAccount });
    expect(second.status, second.text).toBe(201);
    adv.new4a = first.body.id; adv.new4b = second.body.id;

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: emp.a4.id } });
    const sub = await prisma.account.findUniqueOrThrow({ where: { id: employee.receivableAccountId! } });
    expect(sub).toMatchObject({ parentId: parentGroupId, name: emp.a4.name, type: "asset", isPosting: true, companyId });
    expect(first.body.accountId).toBe(sub.id);
    expect(second.body.accountId).toBe(sub.id); // الحساب المشترك في الطلب لا يُستخدَم بعد اختيار المجموعة
    expect(await prisma.account.count({ where: { parentId: parentGroupId } })).toBe(1);
    const disbursement = await prisma.journalEntryLine.findFirstOrThrow({ where: { employeeAdvanceId: adv.new4a, debit: { gt: 0 } } });
    expect(disbursement.accountId).toBe(sub.id);
    // لا بند رواتب يُنشأ لكل سلفة بعد الآن
    expect(await prisma.payrollComponent.count({ where: { companyId, name: { startsWith: "قسط سلفة" } } })).toBe(1);
  });

  it("every new draft includes each active advance: min(installment, balance, net before it); none = needs installment", async () => {
    const run = await call("POST", "/payroll-runs", { companyId, month: "2026-11", employeeIds: Object.values(emp).map((e) => e.id) });
    expect(run.status, run.text).toBe(201);
    runId = run.body.id;
    const rows = await rowsOf(runId);

    expect(installment(rows, emp.a1.id, adv.old1).amount).toBe(1000);
    const a1 = rows.rows.find((r: any) => r.employeeId === emp.a1.id);
    expect(a1.net).toBe(4000); // لا خصم مزدوج عبر بند Phase E القديم
    expect(rows.columns.some((c: any) => c.name.startsWith("قسط سلفة"))).toBe(false);

    expect(installment(rows, emp.a2.id, adv.old2)).toMatchObject({ amount: 0, needsInstallment: true });
    expect(rows.warnings.needsInstallment).toEqual([expect.objectContaining({ employeeId: emp.a2.id, advanceId: adv.old2, remainingBalance: 1500 })]);

    // أ3: القسط 2500 والرصيد 5000 لكن صافيه قبل القسط 2000
    expect(installment(rows, emp.a3.id, adv.old3).amount).toBe(2000);
    expect(rows.rows.find((r: any) => r.employeeId === emp.a3.id).net).toBe(0);

    expect(installment(rows, emp.a4.id, adv.new4a).amount).toBe(300);
    expect(installment(rows, emp.a4.id, adv.new4b).amount).toBe(200);

    // تحذير النسبة القصوى (20% من الإجمالي) دون منع ولا تخفيض: أ3 (2000 من 2000) وحده — أ1 = 1000 من 5000 بالضبط
    expect(rows.warnings.installmentOverMax.map((w: any) => w.employeeId)).toEqual([emp.a3.id]);
  });

  it("postponing an installment zeroes it for this run only, needs a reason, is audited and can be undone while draft", async () => {
    expect((await call("POST", `/payroll-runs/${runId}/advance-postponements`, { employeeAdvanceId: adv.old1, reason: "" })).status).toBe(400);
    const postponed = await call("POST", `/payroll-runs/${runId}/advance-postponements`, { employeeAdvanceId: adv.old1, reason: "طلب الموظف لظرف عائلي" });
    expect(postponed.status, postponed.text).toBe(201);
    expect(postponed.body).toMatchObject({ reason: "طلب الموظف لظرف عائلي", employeeId: emp.a1.id });
    expect(postponed.body.createdBy).toBeTruthy();
    expect(postponed.body.createdAt).toBeTruthy();
    expect((await call("POST", `/payroll-runs/${runId}/advance-postponements`, { employeeAdvanceId: adv.old1, reason: "مرة أخرى" })).status).toBe(400);

    let rows = await rowsOf(runId);
    expect(installment(rows, emp.a1.id, adv.old1)).toMatchObject({ amount: 0, postponed: { reason: "طلب الموظف لظرف عائلي" } });
    expect(rows.rows.find((r: any) => r.employeeId === emp.a1.id).net).toBe(5000);
    expect(await balanceOf(adv.old1)).toBe(3000);
    expect(await prisma.auditLog.count({ where: { tenantId, action: "payroll_run.advance_installment_postponed", entityId: runId } })).toBe(1);

    const undo = await call("DELETE", `/payroll-runs/${runId}/advance-postponements/${adv.old1}`);
    expect(undo.status, undo.text).toBe(200);
    rows = await rowsOf(runId);
    expect(installment(rows, emp.a1.id, adv.old1).amount).toBe(1000);
    expect(await prisma.auditLog.count({ where: { tenantId, action: "payroll_run.advance_postponement_undone", entityId: runId } })).toBe(1);

    expect((await call("POST", `/payroll-runs/${runId}/advance-postponements`, { employeeAdvanceId: adv.old1, reason: "طلب الموظف لظرف عائلي" })).status).toBe(201);
  });

  it("posting credits each installment to the advance's own account and violations to the employee sub-account", async () => {
    const violation = await call("POST", "/hr-actions", { employeeIds: [emp.a2.id], month: "2026-11", componentId: comp.violation, value: 75 });
    expect(violation.status, violation.text).toBeLessThan(300);
    const posted = await call("POST", `/payroll-runs/${runId}/post`);
    expect(posted.status, posted.text).toBe(200);
    const lines = (await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.body.journalEntryId }, include: { lines: true } })).lines;
    expect(lines.reduce((s, l) => s + cents(l.debit), 0)).toBe(lines.reduce((s, l) => s + cents(l.credit), 0));

    const a4Sub = (await prisma.employee.findUniqueOrThrow({ where: { id: emp.a4.id } })).receivableAccountId!;
    const byAdvance = (id: string) => lines.filter((l) => l.employeeAdvanceId === id);
    expect(byAdvance(adv.old1)).toHaveLength(0); // مؤجَّل
    expect(byAdvance(adv.old2)).toHaveLength(0); // بلا قسط
    expect(byAdvance(adv.old3).map((l) => [l.accountId, Number(l.credit)])).toEqual([[sharedAdvanceAccount, 2000]]);
    expect(byAdvance(adv.new4a).map((l) => [l.accountId, Number(l.credit), l.employeeId])).toEqual([[a4Sub, 300, emp.a4.id]]);
    expect(byAdvance(adv.new4b).map((l) => [l.accountId, Number(l.credit)])).toEqual([[a4Sub, 200]]);

    // المخالفة: دائن حساب ذمة أ2 الفرعي (أُنشئ الآن تحت المجموعة)
    const a2Sub = (await prisma.employee.findUniqueOrThrow({ where: { id: emp.a2.id } })).receivableAccountId!;
    expect((await prisma.account.findUniqueOrThrow({ where: { id: a2Sub } })).parentId).toBe(parentGroupId);
    const violationLine = lines.filter((l) => l.accountId === a2Sub);
    expect(violationLine.map((l) => Number(l.credit))).toEqual([75]);
    expect(lines.filter((l) => !l.employeeAdvanceId && l.accountId === sharedAdvanceAccount)).toHaveLength(0);

    expect(await balanceOf(adv.old1)).toBe(3000);
    expect(await balanceOf(adv.old3)).toBe(3000);
    expect(await balanceOf(adv.new4a)).toBe(900);
  });

  describe("mirror and reversal (CLAUDE.md rule 1)", () => {
    it("an advance's own disbursement entry cannot be reversed — the advance would keep being deducted", async () => {
      const advance = await prisma.employeeAdvance.findUniqueOrThrow({ where: { id: adv.new4b } });
      const res = await call("POST", `/journal-entries/${advance.journalEntryId}/reverse`, { date: "2026-11-30" });
      expect(res.status).toBe(400);
      expect(res.text).toContain("صرف سلفة");
    });

    it("a payroll entry with installments cannot be reversed", async () => {
      const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
      expect((await call("POST", `/journal-entries/${run.journalEntryId}/reverse`, { date: "2026-11-30" })).status).toBe(400);
    });

    it("a mirror cannot use the origin company's employee sub-account or advance, and reversing a mirror leaves advances alone", async () => {
      const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
      const a4Sub = (await prisma.employee.findUniqueOrThrow({ where: { id: emp.a4.id } })).receivableAccountId!;
      const target = await prisma.account.findMany({ where: { companyId: otherCompanyId, isPosting: true }, take: 2, orderBy: { code: "asc" } });
      const withSub = await call("POST", `/journal-entries/${run.journalEntryId}/mirror`, {
        targetCompanyId: otherCompanyId, date: "2026-11-28", lines: [{ accountId: a4Sub, debit: 50, credit: 0 }, { accountId: target[1].id, debit: 0, credit: 50 }],
      });
      expect(withSub.status).toBe(400);
      const withAdvance = await call("POST", `/journal-entries/${run.journalEntryId}/mirror`, {
        targetCompanyId: otherCompanyId, date: "2026-11-28",
        lines: [{ accountId: target[0].id, debit: 50, credit: 0, employeeAdvanceId: adv.new4a }, { accountId: target[1].id, debit: 0, credit: 50 }],
      });
      expect(withAdvance.status).toBe(400);

      const mirror = await call("POST", `/journal-entries/${run.journalEntryId}/mirror`, {
        targetCompanyId: otherCompanyId, date: "2026-11-28", lines: [{ accountId: target[0].id, debit: 50, credit: 0 }, { accountId: target[1].id, debit: 0, credit: 50 }],
      });
      expect(mirror.status, mirror.text).toBe(201);
      const before = { a4: await balanceOf(adv.new4a), postponements: await prisma.payrollAdvancePostponement.count({ where: { payrollRunId: runId } }) };
      expect((await call("POST", `/journal-entries/${mirror.body.id}/reverse`, { date: "2026-11-29" })).status).toBe(201);
      expect(await balanceOf(adv.new4a)).toBe(before.a4);
      expect(await prisma.payrollAdvancePostponement.count({ where: { payrollRunId: runId } })).toBe(before.postponements);
      // الكشف لا يُفَك ترحيله وقيده له مرآة — تُزال المرآة (وعكسها) أولاً
      expect((await call("POST", `/payroll-runs/${runId}/unpost`, { pin: PIN })).status).toBe(400);
      const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { reversalOfEntryId: mirror.body.id } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: [reversal.id, mirror.body.id] } } });
      await prisma.journalEntry.update({ where: { id: run.journalEntryId! }, data: { mirrorEntryId: null } });
    });
  });

  it("unposting restores balances and keeps the postponement with the draft; reposting respects it; next month includes the installment again", async () => {
    const unpost = await call("POST", `/payroll-runs/${runId}/unpost`, { pin: PIN });
    expect(unpost.status, unpost.text).toBe(200);
    expect(await balanceOf(adv.old3)).toBe(5000);
    expect(await balanceOf(adv.new4a)).toBe(1200);
    expect(await balanceOf(adv.old1)).toBe(3000);
    expect(await prisma.payrollAdvancePostponement.count({ where: { payrollRunId: runId } })).toBe(1);

    const reposted = await call("POST", `/payroll-runs/${runId}/post`);
    expect(reposted.status, reposted.text).toBe(200);
    const lines = (await prisma.journalEntry.findUniqueOrThrow({ where: { id: reposted.body.journalEntryId }, include: { lines: true } })).lines;
    expect(lines.filter((l) => l.employeeAdvanceId === adv.old1)).toHaveLength(0);
    expect(await balanceOf(adv.old3)).toBe(3000);
    expect(await prisma.employeeAdvanceDeduction.count({ where: { payrollRunId: runId } })).toBe(3);

    const december = await call("POST", "/payroll-runs", { companyId, month: "2026-12", employeeIds: [emp.a1.id] });
    expect(december.status, december.text).toBe(201);
    const rows = await rowsOf(december.body.id);
    expect(installment(rows, emp.a1.id, adv.old1)).toMatchObject({ amount: 1000, postponed: null });
    // حذف المسودة يحذف تأجيلاتها معها
    await call("POST", `/payroll-runs/${december.body.id}/advance-postponements`, { employeeAdvanceId: adv.old1, reason: "اختبار الحذف" });
    expect((await call("DELETE", `/payroll-runs/${december.body.id}`)).status).toBe(200);
    expect(await prisma.payrollAdvancePostponement.count({ where: { payrollRunId: december.body.id } })).toBe(0);
  });

  it("an advance without installment gets one from the advances screen and is then deducted", async () => {
    const list = await call("GET", `/employee-advances?companyId=${companyId}`);
    expect(list.body.find((a: any) => a.id === adv.old2).needsInstallment).toBe(true);
    expect((await call("PATCH", `/employee-advances/${adv.old2}/installment`, { monthlyInstallment: 2000 })).status).toBe(400); // فوق الرصيد
    const set = await call("PATCH", `/employee-advances/${adv.old2}/installment`, { monthlyInstallment: 500 });
    expect(set.status, set.text).toBe(200);
    expect(set.body.needsInstallment).toBe(false);
    const run = await call("POST", "/payroll-runs", { companyId, month: "2027-01", employeeIds: [emp.a2.id] });
    expect(installment(await rowsOf(run.body.id), emp.a2.id, adv.old2).amount).toBe(500);
    expect((await call("DELETE", `/payroll-runs/${run.body.id}`)).status).toBe(200);
  });

  it("the reclass preview moves each employee's outstanding balance to the sub-account without writing anything, and reports GL differences", async () => {
    // فرقان مقصودان: قيد يدوي على الحساب المشترك بلا وسم موظف (100)، وآخر موسوم بـ أ3 (50)
    const cash = await prisma.account.findFirstOrThrow({ where: { companyId, isBankOrCash: true, isPosting: true } });
    for (const [amount, employeeId] of [[100, null], [50, emp.a3.id]] as const) {
      const res = await call("POST", "/journal-entries", {
        companyId, date: "2026-11-15", memo: "فرق اختبار", post: true,
        lines: [{ accountId: sharedAdvanceAccount, debit: amount, credit: 0, employeeId }, { accountId: cash.id, debit: 0, credit: amount }],
      });
      expect(res.status, res.text).toBe(201);
    }
    const accountsBefore = await prisma.account.count({ where: { companyId } });
    const entriesBefore = await prisma.journalEntry.count({ where: { companyId } });

    const preview = await call("GET", `/employee-advances/reclass-preview?companyId=${companyId}`);
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.posted).toBe(false);
    expect(preview.body.totals.debit).toBe(preview.body.totals.credit);

    const a1Debit = preview.body.lines.find((l: any) => l.employeeId === emp.a1.id && l.debit > 0);
    expect(a1Debit).toMatchObject({ debit: 3000, willBeCreated: true, accountId: null, accountName: emp.a1.name });
    const a2Debit = preview.body.lines.find((l: any) => l.employeeId === emp.a2.id && l.debit > 0);
    expect(a2Debit.accountId).toBe((await prisma.employee.findUniqueOrThrow({ where: { id: emp.a2.id } })).receivableAccountId);
    expect(preview.body.lines.filter((l: any) => l.credit > 0).every((l: any) => l.accountId === sharedAdvanceAccount)).toBe(true);
    expect(preview.body.lines.some((l: any) => l.employeeId === emp.a4.id)).toBe(false); // سلف أ4 على حسابه أصلاً

    const shared = preview.body.accounts.find((a: any) => a.accountId === sharedAdvanceAccount);
    expect(shared.advancesRemaining).toBe(3000 + 1500 + 3000);
    expect(shared.glBalance).toBe(shared.advancesRemaining + 150);
    expect(shared.difference).toBe(150);
    expect(shared.untaggedGlBalance).toBe(100);
    expect(shared.employees.find((e: any) => e.employeeId === emp.a3.id)).toMatchObject({ advancesRemaining: 3000, difference: 50 });
    expect(shared.employees.find((e: any) => e.employeeId === emp.a1.id).difference).toBe(0);

    expect(await prisma.account.count({ where: { companyId } })).toBe(accountsBefore);
    expect(await prisma.journalEntry.count({ where: { companyId } })).toBe(entriesBefore);
    expect(await prisma.employeeAdvance.count({ where: { tenantId, accountId: sharedAdvanceAccount } })).toBe(3);
  });
});
