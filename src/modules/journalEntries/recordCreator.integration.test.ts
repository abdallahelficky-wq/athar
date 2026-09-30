import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * سجل التاريخ، القطعة الأولى: من أنشأ القيد ومتى — عبر مسارات HTTP الحقيقية على Postgres فعلي، بكل مسارات الإنشاء التي
 * يغطّيها المُشغِّل (يدوي، عكس، مرآة، استيراد جماعي createMany)، والاستكمال الرجعي بنفس جملة الترحيل حرفياً:
 * - الاسم نسخة محفوظة لحظة الإنشاء: تغيير اسم المستخدم لاحقاً لا يغيّر «أعدّه» لقيد مسجَّل؛
 * - الاستكمال يُعلَّم "backfilled" لا "recorded"، وcreatedBy الفارغ أو المشير لمستخدم غير موجود ⇒ name = null («غير مسجَّل»).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
let ownerToken = "";
let clerkToken = "";
let clerkId = "";
let tenantId = "";
let companyId = "";
let cash = "";
let revenue = "";

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

const manual = (token: string, memo: string) => call("POST", "/journal-entries", token, {
  companyId, date: "2026-09-10", memo, post: true,
  lines: [{ accountId: cash, debit: 100, credit: 0 }, { accountId: revenue, debit: 0, credit: 100 }],
});

describe("who created a journal entry, and when (record history, integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `المُنشئ ${stamp}`, businessActivity: "retail", name: "المالك", email: `creator-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    ownerToken = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const identity = await prisma.identity.create({ data: { email: `creator-clerk-${stamp}@example.com` } });
    const clerk = await prisma.user.create({ data: { tenantId, identityId: identity.id, name: "سارة المحاسبة", role: "accountant", companyScope: "all", inviteStatus: "accepted" } });
    clerkId = clerk.id;
    clerkToken = signAccessToken({ sub: clerk.id, tenantId, role: "accountant", companyScope: "all", readOnly: false });
    cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } });
  });

  it("a manual entry carries its creator, recorded at the time, and a later rename does not rewrite it", async () => {
    const created = await manual(clerkToken, "قيد يدوي");
    expect(created.status, created.text).toBe(201);
    const got = await call("GET", `/journal-entries/${created.body.id}`, ownerToken);
    expect(got.body.creator).toMatchObject({ name: "سارة المحاسبة", provenance: "recorded" });
    expect(new Date(got.body.creator.at).getTime()).toBe(new Date(got.body.createdAt).getTime());

    await prisma.user.update({ where: { id: clerkId }, data: { name: "سارة (اسم جديد)" } });
    const after = await call("GET", `/journal-entries/${created.body.id}`, ownerToken);
    expect(after.body.creator.name).toBe("سارة المحاسبة");
    await prisma.user.update({ where: { id: clerkId }, data: { name: "سارة المحاسبة" } });
  });

  it("a reversal and a mirror each carry whoever made them, not the original's creator", async () => {
    const original = await manual(clerkToken, "أصل");
    const reversal = await call("POST", `/journal-entries/${original.body.id}/reverse`, ownerToken, { date: "2026-09-11T00:00:00.000Z" });
    expect(reversal.status, reversal.text).toBe(201);
    expect((await call("GET", `/journal-entries/${reversal.body.id}`, ownerToken)).body.creator).toMatchObject({ name: "المالك", provenance: "recorded" });

    const other = await call("POST", "/companies", ownerToken, { name: `شركة المرآة ${stamp}`, businessActivity: "retail" });
    const oCash = (await prisma.account.findFirstOrThrow({ where: { companyId: other.body.id, code: "111001" } })).id;
    const oRev = (await prisma.account.findFirstOrThrow({ where: { companyId: other.body.id, type: "revenue", isPosting: true } })).id;
    const mirror = await call("POST", `/journal-entries/${original.body.id}/mirror`, ownerToken, {
      targetCompanyId: other.body.id, date: "2026-09-10T00:00:00.000Z", memo: "مرآة",
      lines: [{ accountId: oCash, debit: 100, credit: 0 }, { accountId: oRev, debit: 0, credit: 100 }],
    });
    expect(mirror.status, mirror.text).toBe(201);
    expect((await call("GET", `/journal-entries/${mirror.body.id}`, ownerToken)).body.creator).toMatchObject({ name: "المالك", provenance: "recorded" });
    expect((await call("GET", `/journal-entries/${original.body.id}`, ownerToken)).body.creator.name).toBe("سارة المحاسبة");
  });

  it("entries created in bulk (createMany) are covered too — the trigger, not a call site", async () => {
    const cashName = (await prisma.account.findUniqueOrThrow({ where: { id: cash } })).name;
    const revName = (await prisma.account.findUniqueOrThrow({ where: { id: revenue } })).name;
    const rows = [
      { groupKey: "B1", date: "2026-08-01", memo: "مستورد", accountName: cashName, debit: 50, credit: 0 },
      { groupKey: "B1", date: "2026-08-01", memo: "مستورد", accountName: revName, debit: 0, credit: 50 },
    ];
    const res = await call("POST", "/journal-entries/bulk-import/commit", clerkToken, { companyId, rows, accountMapping: { [cashName]: cash, [revName]: revenue } });
    expect(res.status, res.text).toBeLessThan(300);
    const imported = await prisma.journalEntry.findFirstOrThrow({ where: { companyId, memo: "مستورد" } });
    expect((await call("GET", `/journal-entries/${imported.id}`, ownerToken)).body.creator).toMatchObject({ name: "سارة المحاسبة", provenance: "recorded" });
  });

  it("the migration's backfill marks rebuilt rows as backfilled, and an unknown creator as null («غير مسجَّل»)", async () => {
    const known = await manual(clerkToken, "قديم معروف");
    const noCreator = await manual(ownerToken, "قديم بلا منشئ");
    const ghost = await manual(ownerToken, "قديم بمنشئ غير موجود");
    // حالة ما قبل هذا الترحيل: لا صفوف إنشاء، وcreatedBy فارغ أو يشير إلى مستخدم غير موجود
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [known.body.id, noCreator.body.id, ghost.body.id] }, action: "journal_entry.created" } });
    await prisma.journalEntry.update({ where: { id: noCreator.body.id }, data: { createdBy: null } });
    await prisma.journalEntry.update({ where: { id: ghost.body.id }, data: { createdBy: "user-that-never-existed" } });

    const sql = readFileSync("prisma/migrations/20260929100000_journal_entry_created_audit/migration.sql", "utf8");
    const backfill = sql.slice(sql.lastIndexOf('INSERT INTO "audit_logs"'));
    // نفس جملة الترحيل حرفياً، مقصورة على مستأجر هذا الاختبار
    await prisma.$executeRawUnsafe(backfill.trim().replace(/ON CONFLICT/, `WHERE e."tenantId" = '${tenantId}' ON CONFLICT`).replace(/;$/, ""));

    const creator = async (id: string) => (await call("GET", `/journal-entries/${id}`, ownerToken)).body.creator;
    expect(await creator(known.body.id)).toMatchObject({ name: "سارة المحاسبة", provenance: "backfilled" });
    expect(await creator(noCreator.body.id)).toMatchObject({ name: null, provenance: "backfilled" });
    expect(await creator(ghost.body.id)).toMatchObject({ name: null, provenance: "backfilled" });
    // صفوف مسجَّلة لحظتها لم تُمَس، ولا تكرار
    expect(await prisma.auditLog.count({ where: { tenantId, action: "journal_entry.created", entityId: known.body.id } })).toBe(1);
  });

  it("another tenant cannot read the creator (the entry itself is out of scope)", async () => {
    const mine = await manual(clerkToken, "معزول");
    const r2 = await register({ tenantName: `آخر ${stamp}`, businessActivity: "retail", name: "غريب", email: `creator-other-${stamp}@example.com`, password: "Str0ng-Pass!" });
    const res = await call("GET", `/journal-entries/${mine.body.id}`, r2.accessToken);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("سارة");
  });
});
