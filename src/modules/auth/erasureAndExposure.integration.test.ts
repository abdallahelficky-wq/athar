import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "./auth.service";

/**
 * إصلاحات "محو السجل وكشف الرواتب" عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * 1) حذف الشركة 405 دائماً؛ 2) المستخدم لا يُحذَف متى كان له أثر، والتعطيل يُبطل جلساته؛
 * 3) سجلّا التدقيق بلا مفاتيح أجنبية ويحملان نسخة اسم المنفّذ وبريده، ولا يمحوهما حذف المستأجر، وحذف
 *    المستأجر من لوحة المنصة 405؛ 4) كل مسار فك ترحيل/إزالة مستند مرحّل يتطلب صلاحية فك الترحيل؛
 * 5) قراءات الرواتب والموارد البشرية لأدوار الموارد البشرية فقط، وقائمة الموظفين لغيرها بلا رواتب؛
 * 6) قفل الرقم السري بعد 5 محاولات خاطئة لكل مستخدم مع صف تدقيق لكل محاولة، وتغييره للمالك وحده.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const ownerEmail = `erasure-owner-${stamp}@example.com`;
const password = "Str0ng-Pass!";
const emails: string[] = [ownerEmail];
let tenantId = "";
let companyId = "";
let ownerToken = "";
const tokens: Record<string, string> = {};
const userIds: Record<string, string> = {};

let server: Server;
let baseUrl = "";

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function addMember(role: "admin" | "finance_manager" | "accountant" | "hr_manager" | "viewer") {
  const email = `erasure-${role}-${stamp}@example.com`;
  emails.push(email);
  const identity = await prisma.identity.create({ data: { email } });
  const user = await prisma.user.create({
    data: { tenantId, identityId: identity.id, name: `مستخدم ${role}`, role, companyScope: "all", inviteStatus: "accepted" },
  });
  userIds[role] = user.id;
  tokens[role] = signAccessToken({ sub: user.id, tenantId, role, companyScope: "all", readOnly: false });
}

async function postJournalEntry(amount: number) {
  const [cash, revenue] = await Promise.all([
    prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } }),
    prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", children: { none: {} } } }),
  ]);
  const res = await call("POST", "/journal-entries", ownerToken, {
    companyId,
    date: new Date().toISOString(),
    post: true,
    lines: [
      { accountId: cash.id, debit: amount, credit: 0 },
      { accountId: revenue.id, debit: 0, credit: amount },
    ],
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("erasure and exposure fixes (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const owner = await register({ tenantName: "شركة اختبار المحو", businessActivity: "retail", name: "المالك", email: ownerEmail, password });
    tenantId = owner.tenant.id;
    ownerToken = owner.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    for (const role of ["admin", "finance_manager", "accountant", "hr_manager", "viewer"] as const) await addMember(role);
  }, 60_000);

  afterAll(async () => {
    server?.close();
    if (tenantId) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
      // سجل التدقيق لم يعد يتبع المستأجر (بلا مفتاح أجنبي) — تنظيف صريح لصفوف هذا الاختبار وحده
      await prisma.auditLog.deleteMany({ where: { tenantId } });
    }
    await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  });

  it("1) company deletion returns 405 for every role, including the owner, and deletes nothing", async () => {
    for (const token of [ownerToken, tokens.admin, tokens.viewer]) {
      const res = await call("DELETE", `/companies/${companyId}`, token);
      expect(res.status).toBe(405);
    }
    expect(await prisma.company.count({ where: { id: companyId } })).toBe(1);
  });

  it("2) a user with any footprint cannot be deleted; deactivation blocks sign-in and revokes sessions", async () => {
    // حساب لم يُستخدَم قط (دعوة معلّقة): يُحذَف
    const pendingIdentity = await prisma.identity.create({ data: { email: `erasure-pending-${stamp}@example.com` } });
    emails.push(pendingIdentity.email);
    const pending = await prisma.user.create({
      data: { tenantId, identityId: pendingIdentity.id, name: "دعوة بالخطأ", role: "viewer", inviteStatus: "pending" },
    });
    expect((await call("DELETE", `/auth/users/${pending.id}`, ownerToken)).status).toBe(204);

    // مستخدم ظهر في صف تدقيق واحد فقط (بلا دخول ولا قيود): يُرفَض حذفه
    await prisma.auditLog.create({ data: { tenantId, userId: userIds.viewer, action: "probe", entityType: "User", entityId: userIds.viewer } });
    const refused = await call("DELETE", `/auth/users/${userIds.viewer}`, ownerToken);
    expect(refused.status).toBe(400);
    expect(await prisma.user.count({ where: { id: userIds.viewer } })).toBe(1);

    // مستخدم سبق له الدخول: يُرفَض حذفه
    await prisma.user.update({ where: { id: userIds.hr_manager }, data: { lastLoginAt: new Date() } });
    expect((await call("DELETE", `/auth/users/${userIds.hr_manager}`, ownerToken)).status).toBe(400);

    // التعطيل يُبطل رموز التحديث القائمة
    const token = await prisma.refreshToken.create({
      data: { userId: userIds.viewer, tokenHash: `erasure-${stamp}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect((await call("PATCH", `/auth/users/${userIds.viewer}/active`, ownerToken, { active: false })).status).toBe(200);
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt).not.toBeNull();
    await call("PATCH", `/auth/users/${userIds.viewer}/active`, ownerToken, { active: true });
  });

  it("3) audit rows carry the actor's name and email, survive the deletion of their tenant, and tenant deletion is gone", async () => {
    const row = await prisma.auditLog.create({ data: { tenantId, userId: userIds.accountant, action: "probe.actor", entityType: "User", entityId: "x" } });
    const stored = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.actorName).toBe("مستخدم accountant");
    expect(stored.actorEmail).toBe(`erasure-accountant-${stamp}@example.com`);

    // حذف مستأجر آخر مباشرة من قاعدة البيانات لا يحذف سجل تدقيقه (لا مفتاح أجنبي يتسلسل)
    const doomed = await prisma.tenant.create({ data: { name: "مستأجر يُحذَف", unlockPin: "x" } });
    const orphan = await prisma.auditLog.create({ data: { tenantId: doomed.id, action: "probe.survives", entityType: "Tenant", entityId: doomed.id } });
    await prisma.tenant.delete({ where: { id: doomed.id } });
    expect(await prisma.auditLog.count({ where: { id: orphan.id } })).toBe(1);
    await prisma.auditLog.delete({ where: { id: orphan.id } });

    const { env } = await import("../../config/env");
    const originalKey = env.platformAdminApiKey;
    (env as { platformAdminApiKey?: string }).platformAdminApiKey = "erasure-test-key";
    try {
      const res = await call("DELETE", `/platform-admin/tenants/${tenantId}`, "erasure-test-key");
      expect(res.status).toBe(405);
      expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
    } finally {
      (env as { platformAdminApiKey?: string }).platformAdminApiKey = originalKey;
    }
  });

  it("4) every un-post / posted-removal route requires the un-post permission, not just the role", async () => {
    const routes: [string, string, unknown][] = [
      ["POST", "/sales-invoices/none/unpost", { pin: "1234" }],
      ["POST", "/receipts/none/unpost", { pin: "1234" }],
      ["POST", "/purchase-invoices/none/unpost", { pin: "1234" }],
      ["POST", "/purchase-returns/none/unpost", { pin: "1234" }],
      ["POST", "/sales-returns/none/unpost", { pin: "1234" }],
      ["POST", "/sales-debit-notes/none/unpost", { pin: "1234" }],
      ["POST", "/journal-entries/none/unpost", { pin: "1234" }],
      ["POST", "/payroll-runs/none/unpost", { pin: "1234" }],
      ["DELETE", "/depreciation-runs/none", { pin: "1234" }],
      ["DELETE", "/fixed-assets/none", { pin: "1234" }],
      ["DELETE", "/stock-movements/none", { pin: "1234" }],
      ["DELETE", "/employee-advances/none", { pin: "1234" }],
    ];
    for (const [method, path, body] of routes) {
      // المحاسب (والمدير المالي لمسيرات الرواتب) يجتاز الدور لكن بلا منصب يمنحه فك الترحيل: 403
      const denied = await call(method, path, path.startsWith("/payroll-runs") ? tokens.finance_manager : tokens.accountant, body);
      expect([method, path, denied.status]).toEqual([method, path, 403]);
      // المالك يجتاز الصلاحية فيصل للمعالج نفسه (المستند غير موجود)
      const owner = await call(method, path, ownerToken, body);
      expect([method, path, owner.status === 403]).toEqual([method, path, false]);
    }
  });

  it("5) salary and HR reads are limited to HR roles; others get the employee list without pay fields", async () => {
    const employee = await call("POST", "/employees", ownerToken, {
      companyId, name: "موظف براتب", employeeNumber: `E-${stamp}`, hireDate: "2024-01-01", basicSalary: 9000, housingAllowance: 2000,
    });
    expect(employee.status).toBe(201);
    const employeeId = employee.body.id as string;
    const gated = [
      `/employees/${employeeId}`,
      `/employees/${employeeId}/eos?endDate=2026-01-01&reason=resignation`,
      `/payroll-runs?companyId=${companyId}`,
      `/payroll-runs/none/rows`,
      `/companies/${companyId}/payroll-components`,
      `/companies/${companyId}/payroll-components/adjustable`,
      `/companies/${companyId}/payroll-settings`,
      `/employees/${employeeId}/payroll-components`,
      `/leave-settlements?companyId=${companyId}`,
      `/leave-settlements/preview?employeeId=${employeeId}&leaveStartDate=2026-01-01`,
      `/hr-actions?companyId=${companyId}&month=2026-01`,
      `/hr-reports/expiring-documents?companyId=${companyId}`,
    ];
    for (const path of gated) {
      for (const role of ["viewer", "accountant"] as const) {
        expect([role, path, (await call("GET", path, tokens[role])).status]).toEqual([role, path, 403]);
      }
      expect([path, (await call("GET", path, tokens.hr_manager)).status === 403]).toEqual([path, false]);
    }
    // السُّلف: مغلقة عن "مشاهدة فقط"، مفتوحة للمحاسب الذي يُنشئها ويربطها بالقيود
    expect((await call("GET", `/employee-advances?companyId=${companyId}`, tokens.viewer)).status).toBe(403);
    expect((await call("GET", `/employee-advances?companyId=${companyId}`, tokens.accountant)).status).toBe(200);

    const picker = await call("GET", `/employees?companyId=${companyId}`, tokens.accountant);
    expect(picker.status).toBe(200);
    const listed = picker.body.find((e: { id: string }) => e.id === employeeId);
    expect(listed.name).toBe("موظف براتب");
    expect(picker.text).not.toMatch(/basicSalary|housingAllowance|idNumber|bankAccount|liveBalances/);
    const full = await call("GET", `/employees?companyId=${companyId}`, tokens.hr_manager);
    expect(Number(full.body.find((e: { id: string }) => e.id === employeeId).basicSalary)).toBe(9000);

    // طلبات الإجازة تُضمِّن الموظف: لمستخدم خارج الموارد البشرية بصلاحية عرض الطلبات، حقول التعريف وحدها
    expect((await call("POST", "/leave-requests", ownerToken, { employeeId, type: "annual", startDate: "2026-10-01", endDate: "2026-10-03" })).status).toBe(201);
    const position = await prisma.position.create({ data: { tenantId, name: `عرض الإجازات ${stamp}` } });
    await prisma.positionActionPermission.create({ data: { positionId: position.id, moduleId: "leaveRequests", actionId: "view", level: "read" } });
    await prisma.user.update({ where: { id: userIds.accountant }, data: { positionId: position.id } });
    const leaves = await call("GET", `/leave-requests?companyId=${companyId}`, tokens.accountant);
    expect(leaves.status).toBe(200);
    expect(leaves.body.some((r: { employee: { name: string } }) => r.employee.name === "موظف براتب")).toBe(true);
    expect(leaves.text).not.toMatch(/basicSalary|housingAllowance|idNumber|bankAccount/);

    // إزالة مستند مرحّل تحذف سجلّه قبل كتابة صف التدقيق — الشركة تُمرَّر صراحةً فلا تضيع
    const cash = await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } });
    const advance = await call("POST", "/employee-advances", ownerToken, { companyId, employeeId, accountId: cash.id, amount: 500, startDate: "2026-09-01" });
    expect(advance.status).toBe(201);
    expect((await call("DELETE", `/employee-advances/${advance.body.id}`, ownerToken, { pin: "1234" })).status).toBe(204);
    const removal = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, entityType: "EmployeeAdvance", entityId: advance.body.id } });
    expect(removal.companyId).toBe(companyId);

    const settings = { expenseIncreasePct: 15, minimumCash: 1000, maximumReceivables: 50000 };
    expect((await call("PATCH", `/reports/comprehensive-monthly/settings?companyId=${companyId}`, tokens.viewer, settings)).status).toBe(403);
    expect((await call("PATCH", `/reports/comprehensive-monthly/settings?companyId=${companyId}`, tokens.accountant, settings)).status).toBe(403);
    expect((await call("PATCH", `/reports/comprehensive-monthly/settings?companyId=${companyId}`, tokens.finance_manager, settings)).status).toBe(200);
  });

  it("6) five wrong PINs lock un-posting for that user for 15 minutes, each failure is audited, and only the owner changes the PIN", async () => {
    const entryId = await postJournalEntry(321);
    const ownerId = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).ownerId!;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await call("POST", `/journal-entries/${entryId}/unpost`, ownerToken, { pin: "0000" });
      expect(res.status).toBe(403);
    }
    const failures = await prisma.auditLog.findMany({ where: { tenantId, userId: ownerId, action: "unlock_pin.failed" }, orderBy: { createdAt: "asc" } });
    expect(failures).toHaveLength(5);
    expect(failures[4].actorEmail).toBe(ownerEmail);
    expect((failures[4].metadata as { locked: boolean }).locked).toBe(true);

    // الرقم الصحيح أثناء القفل مرفوض، ولا يفك ترحيل القيد
    const whileLocked = await call("POST", `/journal-entries/${entryId}/unpost`, ownerToken, { pin: "1234" });
    expect(whileLocked.status).toBe(403);
    expect(whileLocked.text).toMatch(/مقفل/);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe("posted");
    // القفل مدته 15 دقيقة ومسجَّل على هذا المستخدم وحده (عمود في users) — يُزال هنا يدوياً لمتابعة الاختبار
    const lockedUntil = (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).unlockPinLockedUntil!;
    expect(lockedUntil.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    await prisma.user.update({ where: { id: ownerId }, data: { unlockPinLockedUntil: null } });

    // تغيير الرقم: للمالك وحده، ويرفض الافتراضي
    expect((await call("PATCH", "/auth/unlock-pin", tokens.admin, { currentPin: "1234", newPin: "482913" })).status).toBe(403);
    expect((await call("PATCH", "/auth/unlock-pin", ownerToken, { currentPin: "1234", newPin: "1234" })).status).toBe(400);
    expect((await call("PATCH", "/auth/unlock-pin", ownerToken, { currentPin: "1234", newPin: "482913" })).status).toBe(204);
    expect(await prisma.auditLog.count({ where: { tenantId, action: "unlock_pin.changed" } })).toBe(1);
    // الرقم الجديد يفك الترحيل، والقديم لم يعد يعمل
    expect((await call("POST", `/journal-entries/${entryId}/unpost`, ownerToken, { pin: "1234" })).status).toBe(403);
    expect((await call("POST", `/journal-entries/${entryId}/unpost`, ownerToken, { pin: "482913" })).status).toBe(200);
    const unpostRow = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "journal_entry.unpost", entityId: entryId } });
    expect(unpostRow.companyId).toBe(companyId);
    expect(unpostRow.actorEmail).toBe(ownerEmail);
  }, 60_000);
});
