import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { hashPassword } from "../../lib/password";
import { createApp } from "../../app";
import { register } from "./auth.service";

/**
 * إدارة المستخدمين عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * 1) حذف موظف ترك العمل: يختفي من القوائم ولا يدخل، ويبقى كل قيد أنشأه منسوباً لاسمه؛
 * 2) دعوة البريد نفسه لاحقاً تستعيد العضوية نفسها لا عضوية ثانية؛
 * 3) التعديل: الاسم/الدور/النطاق، والمنصب للمالك وحده، ولا يرفع مدير مالي أحداً إلى مدير؛
 * 4) مستأجران شركتاهما بالاسم نفسه: لا يصل أحدهما لمستخدمي الآخر ولا لشركته أو منصبه.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const password = "Str0ng-Pass!";
const emails: string[] = [];
const tenantIds: string[] = [];
let server: Server;
let baseUrl = "";

type Tenant = { tenantId: string; companyId: string; ownerId: string; ownerToken: string };
let a: Tenant;
let b: Tenant;

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

async function registerTenant(label: string): Promise<Tenant> {
  const email = `users-${label}-owner-${stamp}@example.com`;
  emails.push(email);
  // الاسم نفسه للشركتين عمداً: أي ربط بالاسم بدل المعرّف يظهر في النتائج.
  const owner = await register({ tenantName: "شركة مكررة الاسم", businessActivity: "retail", name: `مالك ${label}`, email, password });
  tenantIds.push(owner.tenant.id);
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: owner.tenant.id } })).id;
  return { tenantId: owner.tenant.id, companyId, ownerId: owner.user.id, ownerToken: owner.accessToken };
}

async function addMember(t: Tenant, label: string, role: "admin" | "finance_manager" | "accountant" | "viewer") {
  const email = `users-${label}-${stamp}@example.com`;
  emails.push(email);
  const identity = await prisma.identity.create({ data: { email, passwordHash: await hashPassword(password) } });
  const user = await prisma.user.create({
    data: { tenantId: t.tenantId, identityId: identity.id, name: `موظف ${label}`, role, companyScope: "all", inviteStatus: "accepted" },
  });
  const token = signAccessToken({ sub: user.id, tenantId: t.tenantId, role, companyScope: "all", readOnly: false });
  return { id: user.id, email, token };
}

describe("user management (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await registerTenant("a");
    b = await registerTenant("b");
  }, 60_000);

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.journalEntry.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { tenantId } });
    }
    await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  });

  it("1) deleting an employee who left hides them and blocks sign-in, but their entries stay attributed to them", async () => {
    const leaver = await addMember(a, "leaver", "accountant");
    // دخول حقيقي (يُنشئ رمز تحديث ويختم lastLoginAt) ثم قيد مرحَّل عبر مسار الترحيل نفسه
    const login = await call("POST", "/auth/login", null, { email: leaver.email, password });
    expect(login.status).toBe(200);
    const [cash, revenue] = await Promise.all([
      prisma.account.findFirstOrThrow({ where: { companyId: a.companyId, code: "111001" } }),
      prisma.account.findFirstOrThrow({ where: { companyId: a.companyId, type: "revenue", children: { none: {} } } }),
    ]);
    const entry = await call("POST", "/journal-entries", login.body.accessToken, {
      companyId: a.companyId, date: new Date().toISOString(), post: true,
      lines: [{ accountId: cash.id, debit: 75, credit: 0 }, { accountId: revenue.id, debit: 0, credit: 75 }],
    });
    expect(entry.status).toBe(201);
    const position = await call("POST", "/positions", a.ownerToken, { name: `منصب ${stamp}` });
    expect((await call("POST", `/positions/${position.body.id}/members`, a.ownerToken, { userId: leaver.id })).status).toBe(200);
    await prisma.userActionPermissionOverride.create({ data: { userId: leaver.id, moduleId: "leaveRequests", actionId: "approve", level: "approve" } });

    const deleted = await call("DELETE", `/auth/users/${leaver.id}`, a.ownerToken);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ archived: true });

    // يختفي من قائمة المستخدمين ومن قائمة المرشّحين للمناصب
    expect((await call("GET", "/auth/users", a.ownerToken)).body.map((u: { id: string }) => u.id)).not.toContain(leaver.id);
    expect((await call("GET", "/positions/assignable-users", a.ownerToken)).body.map((u: { id: string }) => u.id)).not.toContain(leaver.id);
    // لا يدخل، ولا تتجدّد جلسته القائمة، ولا تُفتح له الواجهة
    expect((await call("POST", "/auth/login", null, { email: leaver.email, password })).status).toBe(401);
    expect((await call("POST", "/auth/refresh", null, { refreshToken: login.body.refreshToken })).status).toBe(401);
    expect((await call("GET", "/auth/me", login.body.accessToken)).status).toBe(401);
    // مفصول عن منصبه واستثناءاته
    const kept = await prisma.user.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(kept.positionId).toBeNull();
    expect(await prisma.userActionPermissionOverride.count({ where: { userId: leaver.id } })).toBe(0);
    // القيد باقٍ ومنسوب إليه، واسمه ما زال يُقرأ منه
    const stored = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.body.id } });
    expect(stored.createdBy).toBe(leaver.id);
    expect(kept.name).toBe("موظف leaver");
    // الحذف نفسه مسجَّل باسم من نفّذه
    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: a.tenantId, action: "user.deleted", entityId: leaver.id } });
    expect(auditRow.userId).toBe(a.ownerId);
    // لا يُحذَف مرتين ولا يُعدَّل بعد حذفه
    expect((await call("DELETE", `/auth/users/${leaver.id}`, a.ownerToken)).status).toBe(404);
    expect((await call("PATCH", `/auth/users/${leaver.id}`, a.ownerToken, { name: "اسم جديد" })).status).toBe(404);
  }, 60_000);

  it("2) re-inviting a deleted employee's email restores the same membership", async () => {
    const returning = await addMember(a, "returning", "viewer");
    await prisma.user.update({ where: { id: returning.id }, data: { lastLoginAt: new Date() } });
    expect((await call("DELETE", `/auth/users/${returning.id}`, a.ownerToken)).body).toEqual({ archived: true });

    const invited = await call("POST", "/auth/invite", a.ownerToken, { name: "عائد", email: returning.email, role: "accountant", companyScope: "all" });
    expect(invited.status).toBe(201);
    expect(invited.body.id).toBe(returning.id);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: returning.id } });
    expect(restored.deletedAt).toBeNull();
    expect(restored.inviteStatus).toBe("pending");
    expect(restored.role).toBe("accountant");
    // عضوية قائمة (غير محذوفة) ما زالت ترفض دعوة مكررة
    expect((await call("POST", "/auth/invite", a.ownerToken, { name: "مكرر", email: returning.email, role: "viewer", companyScope: "all" })).status).toBe(409);
  });

  it("3) editing: name, role and scope; position by the owner only; a finance manager cannot grant admin", async () => {
    const target = await addMember(a, "edited", "viewer");
    const fm = await addMember(a, "fm", "finance_manager");
    const admin = await addMember(a, "admin", "admin");

    const edited = await call("PATCH", `/auth/users/${target.id}`, fm.token, { name: "اسم معدّل", role: "accountant", companyScope: a.companyId });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "اسم معدّل", role: "accountant", companyScope: a.companyId });

    // المنصب: المالك وحده
    const position = await call("POST", "/positions", a.ownerToken, { name: `منصب التعديل ${stamp}` });
    expect((await call("PATCH", `/auth/users/${target.id}`, fm.token, { positionId: position.body.id })).status).toBe(403);
    expect((await call("PATCH", `/auth/users/${target.id}`, admin.token, { positionId: position.body.id })).status).toBe(403);
    const assigned = await call("PATCH", `/auth/users/${target.id}`, a.ownerToken, { positionId: position.body.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.positionId).toBe(position.body.id);
    expect((await call("GET", "/auth/users", a.ownerToken)).body.find((u: { id: string }) => u.id === target.id).positionName).toBe(`منصب التعديل ${stamp}`);
    // والمالك يدعو بمنصب مباشرة، والمدير المالي لا
    const invitedWithPosition = await call("POST", "/auth/invite", a.ownerToken, {
      name: "مدعو بمنصب", email: `users-invited-pos-${stamp}@example.com`, role: "viewer", companyScope: "all", positionId: position.body.id,
    });
    emails.push(`users-invited-pos-${stamp}@example.com`);
    expect(invitedWithPosition.status).toBe(201);
    expect(invitedWithPosition.body.positionId).toBe(position.body.id);
    expect((await call("POST", "/auth/invite", fm.token, {
      name: "مدعو", email: `users-invited-fm-${stamp}@example.com`, role: "viewer", companyScope: "all", positionId: position.body.id,
    })).status).toBe(403);

    // دور المدير: لا يمنحه المدير المالي ولا يعدّل مديراً، والمدير يمنحه
    expect((await call("PATCH", `/auth/users/${target.id}`, fm.token, { role: "admin" })).status).toBe(403);
    expect((await call("PATCH", `/auth/users/${admin.id}`, fm.token, { name: "تغيير مدير" })).status).toBe(403);
    expect((await call("PATCH", `/auth/users/${target.id}`, admin.token, { role: "admin" })).status).toBe(200);

    // لا أحد يغيّر دوره بنفسه، ولا دور المالك
    expect((await call("PATCH", `/auth/users/${admin.id}`, admin.token, { role: "viewer" })).status).toBe(400);
    expect((await call("PATCH", `/auth/users/${a.ownerId}`, admin.token, { role: "viewer" })).status).toBe(400);
    // تغيير الدور يُبطل جلسات المستخدم
    const session = await prisma.refreshToken.create({ data: { userId: target.id, tokenHash: `users-${stamp}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await call("PATCH", `/auth/users/${target.id}`, admin.token, { role: "viewer" });
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
  }, 60_000);

  it("4) two tenants with same-named companies cannot reach each other's users, companies or positions", async () => {
    const aUser = await addMember(a, "isolated", "viewer");
    const bPosition = await call("POST", "/positions", b.ownerToken, { name: `منصب ب ${stamp}` });

    expect((await call("PATCH", `/auth/users/${aUser.id}`, b.ownerToken, { name: "اختراق" })).status).toBe(404);
    expect((await call("DELETE", `/auth/users/${aUser.id}`, b.ownerToken)).status).toBe(404);
    expect((await call("GET", "/auth/users", b.ownerToken)).body.map((u: { id: string }) => u.id)).not.toContain(aUser.id);
    // شركة ومنصب من المستأجر الآخر مرفوضان في التعديل والدعوة
    expect((await call("PATCH", `/auth/users/${aUser.id}`, a.ownerToken, { companyScope: b.companyId })).status).toBe(400);
    expect((await call("PATCH", `/auth/users/${aUser.id}`, a.ownerToken, { positionId: bPosition.body.id })).status).toBe(404);
    expect((await call("POST", "/auth/invite", a.ownerToken, {
      name: "خارج النطاق", email: `users-cross-${stamp}@example.com`, role: "viewer", companyScope: b.companyId,
    })).status).toBe(400);
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: aUser.id } });
    expect(untouched).toMatchObject({ name: "موظف isolated", companyScope: "all", positionId: null, deletedAt: null });
  });
});
