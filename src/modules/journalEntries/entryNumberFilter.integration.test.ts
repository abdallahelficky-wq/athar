import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * فلتر «رقم القيد» كان يطابق المعرّف الداخلي جزئياً (id contains): البحث بـ"914" أعاد J00149 وJ00501 لأن معرّفاتها
 * العشوائية تحتوي "914". الآن: الرقم الظاهر جزئياً، والمعرّف حرفياً فقط — في المسار المرقّم والقديم والتصدير معاً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let decoyId = "";

async function get(path: string) {
  const res = await fetch(`${baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, body, text };
}

describe("journal entry-number filter never matches part of the internal id (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `رقم القيد ${stamp}`, businessActivity: "retail", name: "المالك", email: `entry-number-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    const revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;

    // الأرقام تأتي من مسار الترقيم الحقيقي (reserveEntryNumber) — نضبط العدّاد فقط ليقع عليها
    const create = async (seq: number, memo: string) => {
      await prisma.company.update({ where: { id: companyId }, data: { nextJournalEntrySeq: seq } });
      const res = await fetch(`${baseUrl}/api/journal-entries`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId, date: "2026-09-15", memo, post: true,
          lines: [{ accountId: cash, debit: 10, credit: 0 }, { accountId: revenue, debit: 0, credit: 10 }] }),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as { id: string; entryNumber: string };
    };
    expect((await create(914, "أول")).entryNumber).toBe("J00914");
    expect((await create(1914, "ثاني")).entryNumber).toBe("J01914");
    const decoy = await create(149, "شَرَك");
    expect(decoy.entryNumber).toBe("J00149");

    // المعرّف عشوائي (cuid) فلا ينتج النظام معرّفاً يحتوي "914" عند الطلب: قيد حقيقي من المسار نفسه، ثم يُعاد تسمية
    // معرّفه عمداً — كل المفاتيح الأجنبية إلى journal_entries تتبعه (ON UPDATE CASCADE).
    decoyId = `c914${decoy.id.slice(4)}`;
    await prisma.$executeRaw`UPDATE "journal_entries" SET "id" = ${decoyId} WHERE "id" = ${decoy.id}`;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } });
  });

  const numbers = (rows: { entryNumber: string }[]) => rows.map((e) => e.entryNumber).sort();

  it("paginated list: '914' returns exactly J00914 and J01914", async () => {
    const res = await get(`/journal-entries?companyId=${companyId}&entryNumber=914&paginate=1`);
    expect(res.status).toBe(200);
    expect(numbers(res.body.items)).toEqual(["J00914", "J01914"]);
  });

  it("legacy array list: same result", async () => {
    const res = await get(`/journal-entries?companyId=${companyId}&entryNumber=914`);
    expect(Array.isArray(res.body)).toBe(true);
    expect(numbers(res.body)).toEqual(["J00914", "J01914"]);
  });

  it("CSV export: same result", async () => {
    const res = await get(`/journal-entries/export?companyId=${companyId}&entryNumber=914`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("J00914");
    expect(res.text).toContain("J01914");
    expect(res.text).not.toContain("J00149");
  });

  it("the full internal id still finds its entry, in every path", async () => {
    const paged = await get(`/journal-entries?companyId=${companyId}&entryNumber=${decoyId}&paginate=1`);
    expect(numbers(paged.body.items)).toEqual(["J00149"]);
    const legacy = await get(`/journal-entries?companyId=${companyId}&entryNumber=${decoyId}`);
    expect(numbers(legacy.body)).toEqual(["J00149"]);
    expect((await get(`/journal-entries/export?companyId=${companyId}&entryNumber=${decoyId}`)).text).toContain("J00149");
  });
});
