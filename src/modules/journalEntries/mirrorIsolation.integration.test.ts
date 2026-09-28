import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { hashPassword } from "../../lib/password";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * عزل الشركات عبر قيد المرآة (نصفا معاملة واحدة في شركتين)، عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * مستخدم مقيَّد بشركة A يحاول كل عملية تمسّ نصف المرآة في الشركة B — مباشرةً، أو من خلال نصفه هو في A —
 * فيُرفَض كل منها بـ 403 ولا يتغيّر شيء في B. المستخدم يحمل صلاحية فك الترحيل عبر منصبه، حتى تصل محاولة
 * فك الترحيل فعلاً إلى منطق مزامنة المرآة بدل أن يوقفها المسار. (كُشِف هذا الصنف مرة في المراجعة لا في
 * الاختبارات — #113 — فهنا يُغطّى كل مسار.)
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `mirror-iso-${stamp}@example.com`;
const scopedEmail = `mirror-iso-scoped-${stamp}@example.com`;
const PIN = "5719";
let server: Server;
let baseUrl = "";
let ownerToken = "";
let scopedToken = "";
let tenantId = "";
let companyA = "";
let companyB = "";
const acc: Record<string, string> = {};

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

const lines = (cash: string, revenue: string, amount: number) => [
  { accountId: cash, debit: amount, credit: 0 },
  { accountId: revenue, debit: 0, credit: amount },
];

/** زوج مرآة ينشئه المالك: الأصل في `from` والمرآة في الشركة الأخرى، بحالة `post` */
async function mirrorPair(post: boolean, from: "A" | "B" = "A") {
  const [src, dst] = from === "A" ? [companyA, companyB] : [companyB, companyA];
  const [srcCash, srcRev, dstCash, dstRev] = from === "A"
    ? [acc.cashA, acc.revA, acc.cashB, acc.revB]
    : [acc.cashB, acc.revB, acc.cashA, acc.revA];
  const source = await call("POST", "/journal-entries", ownerToken, {
    companyId: src, date: "2026-08-10T09:00:00.000Z", memo: "مصدر", post, lines: lines(srcCash, srcRev, 40),
  });
  expect(source.status, source.text).toBe(201);
  const mirror = await call("POST", `/journal-entries/${source.body.id}/mirror`, ownerToken, {
    targetCompanyId: dst, date: "2026-08-10T09:00:00.000Z", lines: lines(dstCash, dstRev, 40),
  });
  expect(mirror.status, mirror.text).toBe(201);
  return { source: source.body.id as string, mirror: mirror.body.id as string };
}

async function snapshot(id: string) {
  const e = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: { select: { accountId: true, debit: true, credit: true }, orderBy: { id: "asc" } } },
  });
  return e && { status: e.status, memo: e.memo, mirrorEntryId: e.mirrorEntryId, companyId: e.companyId, lines: e.lines.map((l) => [l.accountId, Number(l.debit), Number(l.credit)]) };
}

describe("a user scoped to one company cannot touch the other half of an intercompany mirror (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `عزل المرآة ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    ownerToken = r.accessToken;
    await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
    companyA = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const other = await call("POST", "/companies", ownerToken, { name: `الشركة ب ${stamp}`, businessActivity: "retail" });
    expect(other.status, other.text).toBe(201);
    companyB = other.body.id;
    for (const [key, companyId] of [["A", companyA], ["B", companyB]] as const) {
      acc[`cash${key}`] = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
      acc[`rev${key}`] = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    }

    // محاسب مقيَّد بالشركة A، ومنصبه يمنحه فك الترحيل — ليصل الطلب إلى منطق المرآة نفسه
    const position = await prisma.position.create({
      data: { tenantId, name: `فك ترحيل ${stamp}`, permissions: { create: { moduleId: "accounts", canRead: true, extra: { unpost: true } } } },
    });
    const identity = await prisma.identity.create({ data: { email: scopedEmail } });
    const scoped = await prisma.user.create({
      data: { tenantId, identityId: identity.id, name: "محاسب الشركة أ", role: "accountant", companyScope: companyA, inviteStatus: "accepted", positionId: position.id },
    });
    scopedToken = signAccessToken({ sub: scoped.id, tenantId, role: "accountant", companyScope: companyA, readOnly: false });
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email: { in: [email, scopedEmail] } } });
  });

  it("the scoped user really can work in its own company (so the 403s below are about the mirror, not the user)", async () => {
    const own = await call("POST", "/journal-entries", scopedToken, {
      companyId: companyA, date: "2026-08-10T09:00:00.000Z", memo: "قيد الشركة أ", post: false, lines: lines(acc.cashA, acc.revA, 5),
    });
    expect(own.status, own.text).toBe(201);
    expect((await call("POST", `/journal-entries/${own.body.id}/post`, scopedToken)).status).toBe(200);
    expect((await call("POST", `/journal-entries/${own.body.id}/unpost`, scopedToken, { pin: PIN })).status).toBe(200);
    expect((await call("DELETE", `/journal-entries/${own.body.id}`, scopedToken)).status).toBe(204);
  });

  it("posting its own half of a saved pair is refused, and neither half changes", async () => {
    const { source, mirror } = await mirrorPair(false);
    const before = [await snapshot(source), await snapshot(mirror)];
    expect((await call("POST", `/journal-entries/${source}/post`, scopedToken)).status).toBe(403);
    expect([await snapshot(source), await snapshot(mirror)]).toEqual(before);
  });

  it("un-posting its own half of a posted pair is refused, and neither half changes", async () => {
    const { source, mirror } = await mirrorPair(true);
    const before = [await snapshot(source), await snapshot(mirror)];
    const res = await call("POST", `/journal-entries/${source}/unpost`, scopedToken, { pin: PIN });
    expect(res.status, res.text).toBe(403);
    expect([await snapshot(source), await snapshot(mirror)]).toEqual(before);
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: { in: [source, mirror] }, action: "journal_entry.unpost" } })).toBe(0);
  });

  it("deleting its own saved half of a pair is refused, and the other half keeps its link", async () => {
    const { source, mirror } = await mirrorPair(false);
    const before = [await snapshot(source), await snapshot(mirror)];
    expect((await call("DELETE", `/journal-entries/${source}`, scopedToken)).status).toBe(403);
    expect([await snapshot(source), await snapshot(mirror)]).toEqual(before);
  });

  it("every direct operation on the other company's half is refused and changes nothing", async () => {
    const saved = await mirrorPair(false);
    const posted = await mirrorPair(true);
    const before = [await snapshot(saved.mirror), await snapshot(posted.mirror)];
    const attempts: [string, string, unknown?][] = [
      ["GET", `/journal-entries/${saved.mirror}`],
      ["GET", `/journal-entries/${saved.mirror}/pdf`],
      ["PATCH", `/journal-entries/${saved.mirror}`, { companyId: companyB, date: "2026-08-10T09:00:00.000Z", memo: "تعديل", lines: lines(acc.cashB, acc.revB, 99) }],
      ["PATCH", `/journal-entries/${saved.mirror}`, { companyId: companyA, date: "2026-08-10T09:00:00.000Z", memo: "نقل", lines: lines(acc.cashA, acc.revA, 40) }],
      ["POST", `/journal-entries/${saved.mirror}/post`],
      ["DELETE", `/journal-entries/${saved.mirror}`],
      ["POST", `/journal-entries/${posted.mirror}/unpost`, { pin: PIN }],
      ["POST", `/journal-entries/${posted.mirror}/reverse`, { date: "2026-08-11T09:00:00.000Z" }],
      ["POST", `/journal-entries/${posted.mirror}/mirror-suggestion`, { targetCompanyId: companyA }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, scopedToken, body);
      expect(res.status, `${method} ${path}: ${res.text}`).toBe(403);
    }
    expect([await snapshot(saved.mirror), await snapshot(posted.mirror)]).toEqual(before);
    expect(await prisma.journalEntry.count({ where: { tenantId, reversalOfEntryId: posted.mirror } })).toBe(0);
  });

  it("mirroring its own entry into the other company is refused — neither the suggestion nor the mirror writes there", async () => {
    const own = await call("POST", "/journal-entries", scopedToken, {
      companyId: companyA, date: "2026-08-10T09:00:00.000Z", memo: "للمرآة", post: true, lines: lines(acc.cashA, acc.revA, 12),
    });
    expect(own.status, own.text).toBe(201);
    const accountsInB = await prisma.account.count({ where: { companyId: companyB } });
    const entriesInB = await prisma.journalEntry.count({ where: { companyId: companyB } });

    // الاقتراح كان يُنشئ حساب "ذمم بين الشركات" داخل شجرة الشركة B قبل هذا الإصلاح
    const suggestion = await call("POST", `/journal-entries/${own.body.id}/mirror-suggestion`, scopedToken, { targetCompanyId: companyB });
    expect(suggestion.status, suggestion.text).toBe(403);
    const mirror = await call("POST", `/journal-entries/${own.body.id}/mirror`, scopedToken, {
      targetCompanyId: companyB, date: "2026-08-10T09:00:00.000Z", lines: lines(acc.cashB, acc.revB, 12),
    });
    expect(mirror.status, mirror.text).toBe(403);

    expect(await prisma.account.count({ where: { companyId: companyB } })).toBe(accountsInB);
    expect(await prisma.journalEntry.count({ where: { companyId: companyB } })).toBe(entriesInB);
    expect((await snapshot(own.body.id))?.mirrorEntryId).toBeNull();
  });

  it("mirroring the other company's entry into its own company is refused", async () => {
    const theirs = await call("POST", "/journal-entries", ownerToken, {
      companyId: companyB, date: "2026-08-10T09:00:00.000Z", memo: "قيد ب", post: true, lines: lines(acc.cashB, acc.revB, 7),
    });
    expect(theirs.status, theirs.text).toBe(201);
    const res = await call("POST", `/journal-entries/${theirs.body.id}/mirror`, scopedToken, {
      targetCompanyId: companyA, date: "2026-08-10T09:00:00.000Z", lines: lines(acc.cashA, acc.revA, 7),
    });
    expect(res.status, res.text).toBe(403);
    expect((await snapshot(theirs.body.id))?.mirrorEntryId).toBeNull();
  });

  it("the other company's half never shows in its lists", async () => {
    const { mirror } = await mirrorPair(true);
    expect((await call("GET", `/journal-entries?companyId=${companyB}`, scopedToken)).status).toBe(403);
    const own = await call("GET", `/journal-entries?companyId=${companyA}`, scopedToken);
    expect(own.status).toBe(200);
    expect(own.body.some((e: { id: string }) => e.id === mirror)).toBe(false);
  });

  it("the owner (all companies) can still un-post a pair — both halves move together", async () => {
    const { source, mirror } = await mirrorPair(true, "B");
    expect((await call("POST", `/journal-entries/${source}/unpost`, ownerToken, { pin: PIN })).status).toBe(200);
    expect((await snapshot(source))?.status).toBe("saved");
    expect((await snapshot(mirror))?.status).toBe("saved");
    // وحذف نصف محفوظ يفكّ ارتباط النصف الآخر بدل أن يتركه يشير إلى قيد محذوف
    expect((await call("DELETE", `/journal-entries/${source}`, ownerToken)).status).toBe(204);
    expect((await snapshot(mirror))?.mirrorEntryId).toBeNull();
  });
});
