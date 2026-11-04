import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * إقفال السنة المالية عبر مسارات HTTP الحقيقية على Postgres فعلي — كل الأرقام من القيود والتقارير التي ينتجها
 * النظام نفسه (لا مخرجات مكتوبة يدوياً):
 * - قيد محفوظ داخل السنة يمنع الإقفال؛ السنة الجارية لا تُقفَل قبل انتهائها؛
 * - قيد الإقفال يصفّر الإيرادات والمصروفات في حساب الإقفال لكل فرع، وقائمة دخل السنة المقفلة تبقى كما هي؛
 * - المركز المالي متوازن: صافي الربح فيه للسنة الجديدة وحدها، وربح السنة المقفلة في حساب الإقفال؛
 * - قيد الإقفال لا يُعكَس ولا يُحذَف ولا يُنشأ له قيد مرآة، ولا قيد جديد في يوم الإقفال ولو بتوقيت داخله؛
 * - الفتح اليدوي لا يتجاوز سنة مقفلة؛ إعادة فتح آخر سنة تحذف قيدها وتستعيد التاريخ السابق؛
 * - مستأجر آخر لا يرى إعداد سنة شركة غيره.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `fiscal-${stamp}@example.com`;
const otherEmail = `fiscal-other-${stamp}@example.com`;
let server: Server;
let baseUrl = "";
let token = "";
let otherToken = "";
let tenantId = "";
let otherTenantId = "";
let companyId = "";
let sisterCompanyId = "";
let branchId = "";
let closingEntryId = "";
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

async function entry(date: string, debitAccount: string, creditAccount: string, amount: number, post = true, lineBranch: string | null = null) {
  const res = await call("POST", "/journal-entries", {
    companyId, date, memo: `اختبار ${amount}`, post,
    lines: [
      { accountId: debitAccount, debit: amount, credit: 0, branchId: lineBranch },
      { accountId: creditAccount, debit: 0, credit: amount, branchId: lineBranch },
    ],
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

async function income(from: string, to: string) {
  const res = await call("GET", `/reports/income-statement?companyId=${companyId}&from=${from}&to=${to}`);
  expect(res.status, res.text).toBe(200);
  return res.body;
}

async function balanceSheet(date: string) {
  const res = await call("GET", `/reports/balance-sheet?companyId=${companyId}&date=${date}`);
  expect(res.status, res.text).toBe(200);
  return res.body;
}

const flatten = (nodes: any[]): any[] => nodes.flatMap((n) => [n, ...flatten(n.children || [])]);

describe("fiscal year closing (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `إقفال السنة ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    acc.cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    acc.revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true }, orderBy: { code: "asc" } })).id;
    acc.expense = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "expense", isPosting: true }, orderBy: { code: "asc" } })).id;
    acc.close = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "equity", isPosting: true, code: "331002" } })).id;
    branchId = (await prisma.branch.create({ data: { tenantId, companyId, nameAr: `فرع ${stamp}`, country: "SA", currency: "SAR" } })).id;

    const sister = await call("POST", "/companies", { name: `شركة شقيقة ${stamp}`, businessActivity: "retail" });
    expect(sister.status, sister.text).toBe(201);
    sisterCompanyId = sister.body.id;

    const other = await register({ tenantName: `مستأجر آخر ${stamp}`, businessActivity: "retail", name: "آخر", email: otherEmail, password: "Str0ng-Pass!" });
    otherTenantId = other.tenant.id;
    otherToken = other.accessToken;

    // سنة 2025: إيراد 1,000 (منه 400 لفرع) ومصروف 300؛ سنة 2026: إيراد 500
    await entry("2025-03-10", acc.cash, acc.revenue, 600);
    await entry("2025-05-10", acc.cash, acc.revenue, 400, true, branchId);
    await entry("2025-12-31", acc.expense, acc.cash, 300);
    await entry("2026-02-01", acc.cash, acc.revenue, 500);
  }, 120_000);

  afterAll(async () => {
    server?.close();
    for (const id of [tenantId, otherTenantId].filter(Boolean)) {
      await prisma.fiscalYearClosing.deleteMany({ where: { tenantId: id } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.update({ where: { id }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [email, otherEmail] } } });
  });

  it("another tenant cannot read or close this company's fiscal years", async () => {
    expect((await call("GET", `/companies/${companyId}/fiscal-years`, undefined, otherToken)).status).toBe(404);
    expect((await call("POST", `/companies/${companyId}/fiscal-years/close`, { yearEnd: "2025-12-31" }, otherToken)).status).toBe(404);
  });

  it("previews the first year with entries and blocks closing while a saved entry is inside it", async () => {
    const draft = await entry("2025-07-01", acc.cash, acc.revenue, 50, false);
    const overview = await call("GET", `/companies/${companyId}/fiscal-years`);
    expect(overview.status, overview.text).toBe(200);
    expect(overview.body.suggestedCloseAccountId).toBe(acc.close);
    expect(overview.body.nextClosing.year).toEqual({ start: "2025-01-01", end: "2025-12-31", label: "2025" });
    expect(overview.body.nextClosing).toMatchObject({ totalRevenue: 1000, totalExpense: 300, netIncome: 700, draftCount: 1, blockers: ["drafts"] });
    const blocked = await call("POST", `/companies/${companyId}/fiscal-years/close`, { yearEnd: "2025-12-31", closeAccountId: acc.close });
    expect(blocked.status).toBe(400);
    expect((await call("POST", `/journal-entries/${draft}/post`)).status).toBeLessThan(300);
  });

  it("rejects a non-equity closing account and a stale year", async () => {
    expect((await call("POST", `/companies/${companyId}/fiscal-years/close`, { yearEnd: "2025-12-31", closeAccountId: acc.cash })).status).toBe(400);
    expect((await call("POST", `/companies/${companyId}/fiscal-years/close`, { yearEnd: "2024-12-31", closeAccountId: acc.close })).status).toBe(400);
  });

  it("closes 2025 into the closing account per branch, keeps 2025's income statement, and opens 2026", async () => {
    const before2025 = await income("2025-01-01", "2025-12-31");
    const closed = await call("POST", `/companies/${companyId}/fiscal-years/close`, { yearEnd: "2025-12-31", closeAccountId: acc.close });
    expect(closed.status, closed.text).toBe(200);
    expect(closed.body.fiscalYearClosingDate).toBe("2025-12-31");
    expect(closed.body.closings[0]).toMatchObject({ totalRevenue: 1050, totalExpense: 300, netIncome: 750 });
    expect(closed.body.nextClosing.year.end).toBe("2026-12-31");
    expect(closed.body.nextClosing.blockers).toContain("not_ended");
    closingEntryId = closed.body.closings[0].journalEntryId;

    const closing = await prisma.journalEntry.findUniqueOrThrow({ where: { id: closingEntryId }, include: { lines: true } });
    expect(closing.sourceModule).toBe("fiscal_year_closing");
    expect(closing.date.toISOString().slice(0, 10)).toBe("2025-12-31");
    const sum = (rows: typeof closing.lines, key: "debit" | "credit") => rows.reduce((s, l) => s + Number(l[key]), 0);
    expect(sum(closing.lines, "debit")).toBe(sum(closing.lines, "credit"));
    const closeLines = closing.lines.filter((l) => l.accountId === acc.close);
    expect(closeLines.find((l) => l.branchId === branchId)?.credit.toString()).toBe("400");
    expect(closeLines.find((l) => l.branchId === null)?.credit.toString()).toBe("350");

    // قائمة دخل السنة المقفلة لا تتغيّر بقيد الإقفال
    const after2025 = await income("2025-01-01", "2025-12-31");
    expect(after2025.totalRevenue).toBe(before2025.totalRevenue);
    expect(after2025.netIncome).toBe(750);
    expect((await income("2026-01-01", "2026-12-31")).netIncome).toBe(500);

    // المركز المالي: ربح 2026 وحده في صافي الربح، وربح 2025 في حساب الإقفال، والقائمة متوازنة
    const bs = await balanceSheet("2026-11-01");
    expect(bs.netIncome).toBe(500);
    expect(flatten(bs.equityRoots).find((n) => n.accountId === acc.close)?.amount).toBe(750);
    expect(bs.balanced).toBe(true);
    const branchBs = await call("GET", `/reports/balance-sheet?companyId=${companyId}&date=2026-11-01&branchId=${branchId}`);
    expect(branchBs.body.balanced).toBe(true);
    expect(branchBs.body.netIncome).toBe(0);

    const tb = await call("GET", `/reports/trial-balance?companyId=${companyId}&to=2026-11-01`);
    expect(tb.body.balanced).toBe(true);
  });

  it("locks the closing entry and the closed period", async () => {
    const locked = [
      await call("POST", `/journal-entries/${closingEntryId}/reverse`, { date: "2026-01-05" }),
      await call("DELETE", `/journal-entries/${closingEntryId}`),
      await call("POST", `/journal-entries/${closingEntryId}/mirror-suggestion`, { targetCompanyId: sisterCompanyId }),
    ];
    for (const res of locked) {
      expect(res.status, res.text).toBe(400);
      expect(res.text).toContain("قيد إقفال السنة المالية");
    }
    const inClosedDay = await call("POST", "/journal-entries", {
      companyId, date: "2025-12-31T09:00:00.000Z", memo: "داخل يوم الإقفال", post: true,
      lines: [{ accountId: acc.cash, debit: 10, credit: 0 }, { accountId: acc.revenue, debit: 0, credit: 10 }],
    });
    expect(inClosedDay.status).toBe(400);
    expect((await call("POST", `/companies/${companyId}/fiscal-years/close`, { yearEnd: "2026-12-31", closeAccountId: acc.close })).status).toBe(400);
    expect((await call("PATCH", `/companies/${companyId}/fiscal-years/settings`, { fiscalYearStartMonth: 4 })).status).toBe(400);
  });

  it("manual reopen cannot move the lock into a closed year; reopening the last year removes its entry", async () => {
    expect((await call("POST", `/companies/${companyId}/fiscal-closing/reopen`, { fiscalYearClosingDate: "2025-06-30" })).status).toBe(400);
    const reopened = await call("POST", `/companies/${companyId}/fiscal-years/reopen-last`);
    expect(reopened.status, reopened.text).toBe(200);
    expect(reopened.body.closings).toEqual([]);
    expect(reopened.body.fiscalYearClosingDate).toBeNull();
    expect(await prisma.journalEntry.findUnique({ where: { id: closingEntryId } })).toBeNull();
    const bs = await balanceSheet("2026-11-01");
    expect(bs.netIncome).toBe(1250);
    expect(bs.balanced).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { tenantId, action: { in: ["company.fiscal_year_close", "company.fiscal_year_reopen"] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(["company.fiscal_year_close", "company.fiscal_year_reopen"]);
  });

  it("a company whose year starts in April closes April–March", async () => {
    const settings = await call("PATCH", `/companies/${companyId}/fiscal-years/settings`, { fiscalYearStartMonth: 4 });
    expect(settings.status, settings.text).toBe(200);
    expect(settings.body.nextClosing.year).toEqual({ start: "2024-04-01", end: "2025-03-31", label: "2024/2025" });
    expect(settings.body.nextClosing.netIncome).toBe(600);
    const closed = await call("POST", `/companies/${companyId}/fiscal-years/close`, { yearEnd: "2025-03-31", closeAccountId: acc.close });
    expect(closed.status, closed.text).toBe(200);
    expect(closed.body.nextClosing.year).toEqual({ start: "2025-04-01", end: "2026-03-31", label: "2025/2026" });
    // 400 (مايو) + 50 (يوليو) − 300 (ديسمبر) + 500 (فبراير 2026)
    expect(closed.body.nextClosing.netIncome).toBe(650);
  });
});
