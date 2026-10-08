import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * طلب المالك: الترتيب الافتراضي لكل قائمة قيود «آخر ما أُدخل أولاً» — برقم القيد، لا بتاريخه. قيد بتاريخ قديم أُدخل بعد قيد
 * بتاريخ أحدث كان يغوص أسفل القائمة، فيطبع المستخدم أو يعدّل قيداً آخر بالخطأ. الترتيب بالتاريخ أو المبلغ يبقى بطلب صريح.
 * كل القيود هنا من POST /journal-entries الحقيقي (أرقامها من reserveEntryNumber).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";

async function get(path: string) {
  const res = await fetch(`${baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, body, text };
}

const memos = (rows: { memo: string }[]) => rows.map((e) => e.memo);

describe("journal lists default to last-entered first (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `ترتيب افتراضي ${stamp}`, businessActivity: "retail", name: "المالك", email: `default-sort-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    const revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    // بترتيب الإدخال: الأحدث تاريخاً أولاً، ثم قيد بتاريخ قديم، ثم قيد بتاريخ متوسط — المبالغ مختلفة لفحص الترتيب بالمبلغ
    for (const [date, memo, amount] of [["2026-09-20", "أُدخل أولاً بتاريخ حديث", 300], ["2026-01-05", "أُدخل ثانياً بتاريخ قديم", 100], ["2026-05-10", "أُدخل ثالثاً بتاريخ متوسط", 200]] as const) {
      const res = await fetch(`${baseUrl}/api/journal-entries`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId, date, memo, post: true,
          lines: [{ accountId: cash, debit: amount, credit: 0 }, { accountId: revenue, debit: 0, credit: amount }] }),
      });
      expect(res.status).toBe(201);
    }
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } });
  });

  const lastEnteredFirst = ["أُدخل ثالثاً بتاريخ متوسط", "أُدخل ثانياً بتاريخ قديم", "أُدخل أولاً بتاريخ حديث"];

  it("paginated list: an older-dated entry entered later appears above a newer-dated one", async () => {
    const res = await get(`/journal-entries?companyId=${companyId}&paginate=1`);
    expect(res.status).toBe(200);
    expect(memos(res.body.items)).toEqual(lastEnteredFirst);
  });

  it("the keyset cursor walks the default order one page at a time with no gaps or repeats", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await get(`/journal-entries?companyId=${companyId}&take=1${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.status).toBe(200);
      seen.push(...memos(page.body.items));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(lastEnteredFirst);
  });

  it("legacy array list, CSV export and the dashboard's recent entries use the same default", async () => {
    expect(memos((await get(`/journal-entries?companyId=${companyId}`)).body)).toEqual(lastEnteredFirst);
    const csv = (await get(`/journal-entries/export?companyId=${companyId}`)).text;
    const positions = lastEnteredFirst.map((m) => csv.indexOf(m));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // نفس طلب RecentEntriesTable
    const recent = await get(`/journal-entries?companyId=${companyId}&paginate=1&take=6&sortBy=entrySeq&sortDir=desc`);
    expect(memos(recent.body.items)).toEqual(lastEnteredFirst);
  });

  it("sorting by date or amount still works on request, including across pages", async () => {
    const byDate = await get(`/journal-entries?companyId=${companyId}&paginate=1&sortBy=date&sortDir=desc`);
    expect(memos(byDate.body.items)).toEqual(["أُدخل أولاً بتاريخ حديث", "أُدخل ثالثاً بتاريخ متوسط", "أُدخل ثانياً بتاريخ قديم"]);
    const first = await get(`/journal-entries?companyId=${companyId}&sortBy=date&sortDir=asc&take=2`);
    const rest = await get(`/journal-entries?companyId=${companyId}&sortBy=date&sortDir=asc&take=2&cursor=${first.body.nextCursor}`);
    expect([...memos(first.body.items), ...memos(rest.body.items)]).toEqual(["أُدخل ثانياً بتاريخ قديم", "أُدخل ثالثاً بتاريخ متوسط", "أُدخل أولاً بتاريخ حديث"]);
    const byAmount = await get(`/journal-entries?companyId=${companyId}&paginate=1&sortBy=amount&sortDir=asc`);
    expect(memos(byAmount.body.items)).toEqual(["أُدخل ثانياً بتاريخ قديم", "أُدخل ثالثاً بتاريخ متوسط", "أُدخل أولاً بتاريخ حديث"]);
  });

  it("entries without entrySeq (before its backfill) come last, newest-entered first, and the cursor pages through them", async () => {
    // حالة بيانات سابقة لترحيل entrySeq (CLAUDE.md القاعدة 2: بيانات قديمة) — قيدان حقيقيان يُفرَّغ رقمهما التسلسلي عمداً
    await prisma.journalEntry.updateMany({ where: { companyId, memo: { in: ["أُدخل أولاً بتاريخ حديث", "أُدخل ثانياً بتاريخ قديم"] } }, data: { entrySeq: null } });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await get(`/journal-entries?companyId=${companyId}&take=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...memos(page.body.items));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(lastEnteredFirst);
    expect(memos((await get(`/journal-entries?companyId=${companyId}`)).body)).toEqual(lastEnteredFirst);
  });

  it("filters still apply under the default order", async () => {
    const res = await get(`/journal-entries?companyId=${companyId}&paginate=1&dateFrom=2026-01-01&dateTo=2026-06-30`);
    expect(memos(res.body.items)).toEqual(["أُدخل ثالثاً بتاريخ متوسط", "أُدخل ثانياً بتاريخ قديم"]);
  });
});
