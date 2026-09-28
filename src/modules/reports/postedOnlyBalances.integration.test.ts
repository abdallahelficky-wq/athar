import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { hashPassword } from "../../lib/password";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { buildReportDigestEmail } from "../../lib/reportDigest";

/**
 * الأرصدة تحتسب القيود المرحَّلة فقط، عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * - القيد المحفوظ لا يدخل ميزان المراجعة ولا الأستاذ ويظهر في ملخص "قيود محفوظة"، ويدخل عند ترحيله؛
 * - فك ترحيل قيد يدوي يُخرجه من الأرصدة فعلاً (لم يكن يغيّر رقماً قبل هذا)؛
 * - قيد العكس يُرحَّل فور إنشائه فيُلغي أثر الأصل في الأرصدة مباشرة؛
 * - قيد المرآة بين شركتين يولد بحالة الأصل ويتبعه ترحيلاً وفك ترحيل في الاتجاهين؛
 * - الاستيراد الجماعي محفوظ افتراضياً، ومرحَّل عند طلبه صراحةً؛
 * - مفتاح الشركة: معطَّلاً يُحتسَب المحفوظ ويظهر في ملخص counted؛ تغييره للمالك وحده ومسجَّل في التدقيق.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `posted-only-${stamp}@example.com`;
const PIN = "4826";
let server: Server;
let baseUrl = "";
let token = "";
let accountantToken = "";
let tenantId = "";
let companyId = "";
let otherCompanyId = "";
const acc: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown, as = token) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${as}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function entry(amount: number, post: boolean, forCompany = companyId, cash = acc.cash, revenue = acc.revenue) {
  const res = await call("POST", "/journal-entries", {
    companyId: forCompany, date: "2026-08-10T09:00:00.000Z", memo: `اختبار ${amount}`, post,
    lines: [{ accountId: cash, debit: amount, credit: 0 }, { accountId: revenue, debit: 0, credit: amount }],
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

/** رصيد حساب الصندوق في ميزان المراجعة (مدين − دائن). */
async function cashBalance(forCompany = companyId) {
  const res = await call("GET", `/reports/trial-balance?companyId=${forCompany}`);
  expect(res.status, res.text).toBe(200);
  const row = res.body.rows.find((r: { code: string }) => r.code === "111001");
  return row ? Math.round((row.closing.debit - row.closing.credit) * 100) / 100 : 0;
}

async function drafts(forCompany = companyId) {
  const res = await call("GET", `/reports/draft-entries-summary?companyId=${forCompany}`);
  expect(res.status, res.text).toBe(200);
  return res.body as { uncounted: { entryCount: number; debit: number }; counted: { entryCount: number; debit: number } };
}

describe("balances count posted entries only (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `المرحَّل فقط ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    acc.cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    acc.revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;

    const other = await call("POST", "/companies", { name: `شركة شقيقة ${stamp}`, businessActivity: "retail" });
    expect(other.status, other.text).toBe(201);
    otherCompanyId = other.body.id;
    acc.otherCash = (await prisma.account.findFirstOrThrow({ where: { companyId: otherCompanyId, code: "111001" } })).id;
    acc.otherRevenue = (await prisma.account.findFirstOrThrow({ where: { companyId: otherCompanyId, type: "revenue", isPosting: true } })).id;

    const identity = await prisma.identity.create({ data: { email: `posted-only-acct-${stamp}@example.com` } });
    const accountant = await prisma.user.create({
      data: { tenantId, identityId: identity.id, name: "محاسب", role: "accountant", companyScope: "all", inviteStatus: "accepted" },
    });
    accountantToken = signAccessToken({ sub: accountant.id, tenantId, role: "accountant", companyScope: "all", readOnly: false });
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email: { in: [email, `posted-only-acct-${stamp}@example.com`] } } });
  });

  it("new companies count posted entries only", async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.balancesPostedOnly).toBe(true);
  });

  it("a saved entry is left out of the trial balance and ledger, shown as a draft, and counted once posted", async () => {
    const saved = await entry(111, false);
    expect(await cashBalance()).toBe(0);
    const ledger = await call("GET", `/reports/account-ledger/${acc.cash}?companyId=${companyId}`);
    expect(ledger.status).toBe(200);
    expect(ledger.text).not.toContain("اختبار 111");
    expect((await drafts()).uncounted).toMatchObject({ entryCount: 1, debit: 111 });
    expect((await call("GET", `/reports/draft-entries-summary?companyId=${companyId}&accountId=${acc.cash}`)).body.uncounted.entryCount).toBe(1);

    expect((await call("POST", `/journal-entries/${saved}/post`)).status).toBe(200);
    expect(await cashBalance()).toBe(111);
    expect((await drafts()).uncounted.entryCount).toBe(0);
  });

  it("un-posting a manual entry now changes the balance", async () => {
    const posted = await entry(50, true);
    expect(await cashBalance()).toBe(161);
    const res = await call("POST", `/journal-entries/${posted}/unpost`, { pin: PIN });
    expect(res.status, res.text).toBe(200);
    expect(await cashBalance()).toBe(111);
    expect((await drafts()).uncounted).toMatchObject({ entryCount: 1, debit: 50 });
    await call("DELETE", `/journal-entries/${posted}`);
  });

  it("a reversal is posted on creation and cancels the original in balances immediately", async () => {
    const original = await entry(70, true);
    expect(await cashBalance()).toBe(181);
    const reversal = await call("POST", `/journal-entries/${original}/reverse`, { date: "2026-08-11T09:00:00.000Z" });
    expect(reversal.status, reversal.text).toBeLessThan(300);
    expect(reversal.body.status).toBe("posted");
    expect(await cashBalance()).toBe(111);
  });

  it("an intercompany mirror is born in its source's state and follows it both ways", async () => {
    const source = await entry(30, false);
    const mirror = await call("POST", `/journal-entries/${source}/mirror`, {
      targetCompanyId: otherCompanyId, date: "2026-08-10T09:00:00.000Z", memo: "مرآة",
      lines: [{ accountId: acc.otherCash, debit: 30, credit: 0 }, { accountId: acc.otherRevenue, debit: 0, credit: 30 }],
    });
    expect(mirror.status, mirror.text).toBeLessThan(300);
    expect(mirror.body.status).toBe("saved");

    expect((await call("POST", `/journal-entries/${source}/post`)).status).toBe(200);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: mirror.body.id } })).status).toBe("posted");
    expect(await cashBalance(otherCompanyId)).toBe(30);

    // فك ترحيل نصف المرآة يعيد الأصل محفوظاً معه
    expect((await call("POST", `/journal-entries/${mirror.body.id}/unpost`, { pin: PIN })).status).toBe(200);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: source } })).status).toBe("saved");
    expect(await cashBalance(otherCompanyId)).toBe(0);
    // فك الترحيل الضمني لنصف المرآة الآخر مسجَّل في التدقيق على قيده هو وشركته هي
    const implicit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "journal_entry.unpost", entityId: source } });
    expect(implicit.companyId).toBe(companyId);
    expect(implicit.metadata).toMatchObject({ viaMirrorOf: mirror.body.id });

    // ومرآة قيد مرحَّل تولد مرحَّلة
    const postedSource = await entry(12, true);
    const postedMirror = await call("POST", `/journal-entries/${postedSource}/mirror`, {
      targetCompanyId: otherCompanyId, date: "2026-08-10T09:00:00.000Z",
      lines: [{ accountId: acc.otherCash, debit: 12, credit: 0 }, { accountId: acc.otherRevenue, debit: 0, credit: 12 }],
    });
    expect(postedMirror.body.status).toBe("posted");
    expect(await cashBalance(otherCompanyId)).toBe(12);
  });

  it("bulk import is saved by default and posted only when asked", async () => {
    const cashName = (await prisma.account.findUniqueOrThrow({ where: { id: acc.cash } })).name;
    const revenueName = (await prisma.account.findUniqueOrThrow({ where: { id: acc.revenue } })).name;
    const rows = (key: string, amount: number) => [
      { groupKey: key, date: "2026-08-12", memo: "استيراد", accountName: cashName, debit: amount, credit: 0 },
      { groupKey: key, date: "2026-08-12", memo: "استيراد", accountName: revenueName, debit: 0, credit: amount },
    ];
    const mapping = { [cashName]: acc.cash, [revenueName]: acc.revenue };
    const before = await cashBalance();

    const asDraft = await call("POST", "/journal-entries/bulk-import/commit", { companyId, rows: rows("A1", 7), accountMapping: mapping });
    expect(asDraft.status, asDraft.text).toBe(201);
    expect(await cashBalance()).toBe(before);

    const asPosted = await call("POST", "/journal-entries/bulk-import/commit", { companyId, rows: rows("B1", 9), accountMapping: mapping, status: "posted" });
    expect(asPosted.status, asPosted.text).toBe(201);
    expect(await cashBalance()).toBe(before + 9);
    const imported = await prisma.journalEntry.findMany({ where: { companyId, sourceModule: "bulk_import" }, select: { status: true } });
    expect(imported.map((e) => e.status).sort()).toEqual(["posted", "saved"]);
  });

  it("with the switch off, saved entries count and show as counted; only the owner can flip it, and it is audited", async () => {
    const posted = await cashBalance();
    const pending = await drafts();
    expect(pending.uncounted.entryCount).toBeGreaterThan(0);

    expect((await call("PATCH", `/companies/${companyId}/balances-posted-only`, { enabled: false }, accountantToken)).status).toBe(403);
    const off = await call("PATCH", `/companies/${companyId}/balances-posted-only`, { enabled: false });
    expect(off.status, off.text).toBe(200);
    expect(off.body.balancesPostedOnly).toBe(false);

    const withDrafts = await drafts();
    expect(withDrafts.uncounted.entryCount).toBe(0);
    expect(withDrafts.counted.entryCount).toBe(pending.uncounted.entryCount);
    // كل قيد محفوظ هنا يُدين الصندوق وحده، فمجموع مدينه هو بالضبط ما يعود إلى رصيد الصندوق
    expect(await cashBalance()).toBe(Math.round((posted + pending.uncounted.debit) * 100) / 100);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "company.balances_posted_only_changed" } });
    expect(audit.metadata).toMatchObject({ before: true, after: false, savedEntries: pending.uncounted.entryCount });

    expect((await call("PATCH", `/companies/${companyId}/balances-posted-only`, { enabled: true })).status).toBe(200);
    expect(await cashBalance()).toBe(posted);
  });

  it("the customer statement names its account so the screen can show the drafts on it", async () => {
    const customer = await call("POST", "/customers", { companyId, name: "عميل المسودات" });
    expect(customer.status, customer.text).toBe(201);
    const customerAccountId = (await prisma.customer.findUniqueOrThrow({ where: { id: customer.body.id } })).accountId!;
    await call("POST", "/journal-entries", {
      companyId, date: "2026-08-15T09:00:00.000Z", memo: "مسودة على العميل", post: false,
      lines: [{ accountId: customerAccountId, debit: 25, credit: 0, customerId: customer.body.id }, { accountId: acc.revenue, debit: 0, credit: 25 }],
    });
    const statement = await call("GET", `/reports/customer-statement/${customer.body.id}?companyId=${companyId}`);
    expect(statement.status, statement.text).toBe(200);
    expect(statement.body.accountId).toBe(customerAccountId);
    expect(statement.text).not.toContain("مسودة على العميل");
    const onAccount = await call("GET", `/reports/draft-entries-summary?companyId=${companyId}&accountId=${customerAccountId}`);
    expect(onAccount.body.uncounted).toMatchObject({ entryCount: 1, debit: 25 });
  });

  it("the scheduled report email carries the same draft notice as the screens", async () => {
    const email = await buildReportDigestEmail(tenantId, companyId, { includeTrialBalance: true, includeComprehensiveMonthly: false, includeIncomeStatement: false, includeBalanceSheet: false });
    expect(email.bodyHtml).toContain("غير محتسبة في الأرقام أعلاه");
  });

  it("a user restricted to one company cannot post or un-post the other company's half of a mirror", async () => {
    const source = await entry(15, false);
    const mirror = await call("POST", `/journal-entries/${source}/mirror`, {
      targetCompanyId: otherCompanyId, date: "2026-08-10T09:00:00.000Z",
      lines: [{ accountId: acc.otherCash, debit: 15, credit: 0 }, { accountId: acc.otherRevenue, debit: 0, credit: 15 }],
    });
    expect(mirror.body.status).toBe("saved");
    const identity = await prisma.identity.create({ data: { email: `posted-only-scoped-${stamp}@example.com` } });
    const scoped = await prisma.user.create({
      data: { tenantId, identityId: identity.id, name: "محاسب شركة واحدة", role: "accountant", companyScope: companyId, inviteStatus: "accepted" },
    });
    const scopedToken = signAccessToken({ sub: scoped.id, tenantId, role: "accountant", companyScope: companyId, readOnly: false });
    const res = await call("POST", `/journal-entries/${source}/post`, undefined, scopedToken);
    expect(res.status).toBe(403);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: source } })).status).toBe("saved");
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: mirror.body.id } })).status).toBe("saved");
    await prisma.user.delete({ where: { id: scoped.id } });
    await prisma.identity.delete({ where: { id: identity.id } });
  });

  it("the journal list filtered by a group account includes its sub-accounts (the draft line's link)", async () => {
    const cashAccount = await prisma.account.findUniqueOrThrow({ where: { id: acc.cash } });
    const saved = await entry(3, false);
    const byGroup = await call("GET", `/journal-entries?companyId=${companyId}&status=saved&accountId=${cashAccount.parentId}`);
    expect(byGroup.status).toBe(200);
    expect(byGroup.body.map((e: { id: string }) => e.id)).toContain(saved);
    const summary = await call("GET", `/reports/draft-entries-summary?companyId=${companyId}&accountId=${cashAccount.parentId}`);
    expect(summary.body.uncounted.entryCount).toBe(byGroup.body.length);
  });
});
