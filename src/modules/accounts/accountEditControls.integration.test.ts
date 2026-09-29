import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * ضوابط تعديل شجرة الحسابات والأقسام — عبر مسارات HTTP الحقيقية على Postgres فعلي، ثم محاولة التجاوز مباشرة على
 * قاعدة البيانات لإثبات أن الضابط فيها لا في مسار واحد:
 * - نوع الحساب لا يتغيّر بعد وجود قيود عليه أو على حساب تحته (محفوظة أو مرحَّلة)؛
 * - القسم المستخدَم في سطر قيد لا يُحذَف (كان يُمسح منه بصمت)؛
 * - كل تعديل على حساب يُسجَّل بحقوله قبل/بعد ومن نفّذه — من شاشة الحسابات، ومن تسمية العميل، والنقل، والأرشفة
 *   المتسلسلة، والحذف؛ وتعديل بلا منفّذ يُسجَّل بمنفّذ فارغ لا يُنسَب لأحد.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let cash = "";
let revenue = "";

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

const logsFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { tenantId, entityType: "Account", entityId }, orderBy: { createdAt: "asc" } });

// مجموعات أصول من المستوى الثالث في الشجرة القياسية (الأقل فروعاً أولاً) — كل اختبار يأخذ مجموعته
let groups: string[] = [];
async function newPostingAccount(name: string, groupId: string) {
  const leaf = await call("POST", "/accounts", { companyId, parentId: groupId, name, type: "asset" });
  expect(leaf.status, leaf.text).toBe(201);
  return leaf.body.id as string;
}

describe("account and department edit controls (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `ضوابط الحسابات ${stamp}`, businessActivity: "retail", name: "المالك", email: `acct-ctl-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    const level3 = await prisma.account.findMany({ where: { companyId, type: "asset", level: 3, isPosting: false }, include: { _count: { select: { children: true } } } });
    groups = level3.sort((x, y) => x._count.children - y._count.children).map((g) => g.id);
    expect(groups.length).toBeGreaterThanOrEqual(5);
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } });
  });

  it("an account's type cannot change once it — or an account under it — has entries, even a saved one; the database refuses it too", async () => {
    const groupId = groups[0];
    const leafId = await newPostingAccount(`حساب النوع ${stamp}`, groupId);

    const saved = await call("POST", "/journal-entries", {
      companyId, date: "2026-09-10", memo: "محفوظ", lines: [{ accountId: leafId, debit: 10, credit: 0 }, { accountId: revenue, debit: 0, credit: 10 }],
    });
    expect(saved.status, saved.text).toBe(201);

    const leafChange = await call("PATCH", `/accounts/${leafId}`, { type: "expense" });
    expect(leafChange.status).toBe(400);
    expect(leafChange.body.details.journalLines).toBe(1);
    const groupChange = await call("PATCH", `/accounts/${groupId}`, { type: "expense" });
    expect(groupChange.status).toBe(400);
    expect(groupChange.body.details.journalLines).toBeGreaterThanOrEqual(1);

    // تجاوز الخادم: قاعدة البيانات نفسها ترفض
    await expect(prisma.account.update({ where: { id: leafId }, data: { type: "expense" } })).rejects.toThrow(/account_type_locked/);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: leafId } })).type).toBe("asset");
  });

  it("a department used on a journal line cannot be deleted; an unused one can; the foreign key refuses it too", async () => {
    const used = await call("POST", "/departments", { companyId, name: `قسم مستخدم ${stamp}` });
    const unused = await call("POST", "/departments", { companyId, name: `قسم غير مستخدم ${stamp}` });
    expect(used.status, used.text).toBe(201);
    const entry = await call("POST", "/journal-entries", {
      companyId, date: "2026-09-10", memo: "بقسم", post: true,
      lines: [{ accountId: cash, debit: 5, credit: 0, departmentId: used.body.id }, { accountId: revenue, debit: 0, credit: 5 }],
    });
    expect(entry.status, entry.text).toBe(201);

    const refused = await call("DELETE", `/departments/${used.body.id}`);
    expect(refused.status).toBe(400);
    expect(refused.body.details.journalLines).toBe(1);
    await expect(prisma.department.delete({ where: { id: used.body.id } })).rejects.toThrow();
    // السطر المرحَّل ما زال يحمل قسمه
    expect((await prisma.journalEntryLine.findFirstOrThrow({ where: { journalEntryId: entry.body.id, departmentId: { not: null } } })).departmentId).toBe(used.body.id);

    expect((await call("DELETE", `/departments/${unused.body.id}`)).status).toBe(204);
  });

  it("every account edit is logged with before/after and who did it — rename, cash flag, move (allowed), archive cascade, delete", async () => {
    const a = { groupId: groups[1], leafId: await newPostingAccount(`حساب السجل ${stamp}`, groups[1]) };
    const b = { groupId: groups[2], leafId: await newPostingAccount(`حساب آخر ${stamp}`, groups[2]) };

    expect((await call("PATCH", `/accounts/${a.leafId}`, { name: "اسم جديد", isBankOrCash: true })).status).toBe(200);
    const [renamed] = await logsFor(a.leafId);
    expect(renamed).toMatchObject({ action: "account.updated", actorName: "المالك" });
    expect((renamed.metadata as any).changes).toEqual({
      name: { from: `حساب السجل ${stamp}`, to: "اسم جديد" },
      isBankOrCash: { from: false, to: true },
    });
    expect((renamed.metadata as any).provenance).toBe("recorded");

    // النقل مسموح ويُسجَّل
    const moved = await call("PATCH", `/accounts/${a.leafId}`, { parentId: b.groupId });
    expect(moved.status, moved.text).toBe(200);
    const moveLog = (await logsFor(a.leafId)).find((l) => l.action === "account.moved")!;
    expect((moveLog.metadata as any).changes.parentId).toEqual({ from: a.groupId, to: b.groupId });
    expect(moveLog.actorName).toBe("المالك");

    // الأرشفة المتسلسلة: المجموعة وكل ما تحتها، كلٌّ بسطر ومنفّذ
    expect((await call("PATCH", `/accounts/${b.groupId}`, { isArchived: true })).status).toBe(200);
    for (const id of [b.groupId, b.leafId, a.leafId]) {
      const archived = (await logsFor(id)).find((l) => (l.metadata as any).changes?.isArchived);
      expect(archived?.actorName, id).toBe("المالك");
      expect((archived!.metadata as any).changes.isArchived).toEqual({ from: false, to: true });
    }

    // الحذف (حساب بلا قيود ولا فروع) يُسجَّل بحالته قبل الحذف
    const freshId = await newPostingAccount(`حساب للحذف ${stamp}`, groups[3]);
    expect((await call("DELETE", `/accounts/${freshId}`)).status).toBe(204);
    const deleted = (await logsFor(freshId)).find((l) => l.action === "account.deleted")!;
    expect(deleted.actorName).toBe("المالك");
    expect((deleted.metadata as any).before.name).toBe(`حساب للحذف ${stamp}`);
  });

  it("renaming a customer renames its account, and that edit is logged with the user too", async () => {
    const customer = await call("POST", "/customers", { companyId, name: `عميل ${stamp}` });
    expect(customer.status, customer.text).toBe(201);
    const accountId = (await prisma.customer.findUniqueOrThrow({ where: { id: customer.body.id } })).accountId!;
    expect((await call("PATCH", `/customers/${customer.body.id}`, { name: `عميل معدّل ${stamp}` })).status).toBe(200);
    const [log] = (await logsFor(accountId)).filter((l) => l.action === "account.updated");
    expect(log.actorName).toBe("المالك");
    expect((log.metadata as any).changes.name).toEqual({ from: `عميل ${stamp}`, to: `عميل معدّل ${stamp}` });
  });

  it("an edit that bypasses the app is still logged — with no actor, never attributed to anyone", async () => {
    const leafId = await newPostingAccount(`حساب مباشر ${stamp}`, groups[4]);
    await prisma.account.update({ where: { id: leafId }, data: { isActive: false } });
    const [log] = await logsFor(leafId);
    expect(log).toMatchObject({ action: "account.updated", userId: null, actorName: null });
    expect((log.metadata as any).changes.isActive).toEqual({ from: true, to: false });
  });
});
