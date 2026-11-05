import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * التحليل المالي والنسب عبر مسارات HTTP الحقيقية على Postgres فعلي. القيود تُرحَّل بمسار /journal-entries نفسه،
 * والتصنيف هو ما ينتجه تثبيت القالب عند التسجيل (لا قيم مزروعة يدوياً). الأرقام المتوقعة محسوبة يدوياً من القيود:
 *
 *   15/01  رأس مال            نقدية 100,000 / رأس المال
 *   02/02  شراء مخزون آجل      مخزون 40,000 / موردون
 *   10/02  بيع آجل             عملاء 50,000 / مبيعات      + تكلفة 30,000 / مخزون
 *   15/02  قرض طويل الأجل      نقدية 20,000 / قرض
 *   20/02  فوائد               فوائد تمويل 1,000 / نقدية
 *   25/02  إهلاك               إهلاك 500 / نقدية
 *
 * مستأجر ثانٍ بشركة بالاسم نفسه ومبالغ مختلفة: أي تسرّب بين المستأجرين يظهر في الأرقام.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emails = [`fa-a-${stamp}@example.com`, `fa-b-${stamp}@example.com`];
let server: Server;
let baseUrl = "";
const tenants: { id: string; token: string; companyId: string; acc: Record<string, string> }[] = [];

async function call(token: string, method: string, path: string, body?: unknown) {
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

async function post(t: (typeof tenants)[number], date: string, debit: string, credit: string, amount: number) {
  const res = await call(t.token, "POST", "/journal-entries", {
    companyId: t.companyId, date: `${date}T09:00:00.000Z`, memo: `تحليل ${amount}`, post: true,
    lines: [{ accountId: t.acc[debit], debit: amount, credit: 0 }, { accountId: t.acc[credit], debit: 0, credit: amount }],
  });
  expect(res.status, res.text).toBe(201);
}

const CODES = { cash: "111001", ar: "112001", inv: "114001", ap: "211001", loan: "221001", capital: "311001", sales: "411001", cogs: "511001", dep: "651001", interest: "721001" };

async function analysis(t: (typeof tenants)[number], from: string, to: string) {
  const res = await call(t.token, "GET", `/reports/financial-analysis?companyId=${t.companyId}&from=${from}&to=${to}`);
  expect(res.status, res.text).toBe(200);
  return res.body;
}
const ratio = (body: any, key: string) => body.ratios.find((r: any) => r.key === key).value;

describe("financial analysis and ratios (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const email of emails) {
      // نفس اسم المستأجر والشركة في الاثنين عمداً
      const r = await register({ tenantName: `تحليل ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
      const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
      const acc: Record<string, string> = {};
      for (const [key, code] of Object.entries(CODES)) acc[key] = (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
      tenants.push({ id: r.tenant.id, token: r.accessToken, companyId, acc });
    }
    const [a, b] = tenants;
    await post(a, "2026-01-15", "cash", "capital", 100_000);
    await post(a, "2026-02-02", "inv", "ap", 40_000);
    await post(a, "2026-02-10", "ar", "sales", 50_000);
    await post(a, "2026-02-10", "cogs", "inv", 30_000);
    await post(a, "2026-02-15", "cash", "loan", 20_000);
    await post(a, "2026-02-20", "interest", "cash", 1_000);
    await post(a, "2026-02-25", "dep", "cash", 500);
    await post(b, "2026-01-15", "cash", "capital", 7_000);
    await post(b, "2026-02-10", "ar", "sales", 3_000);
  }, 180_000);

  afterAll(async () => {
    server?.close();
    for (const t of tenants) {
      await prisma.journalEntry.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.update({ where: { id: t.id }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.delete({ where: { id: t.id } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  });

  it("the registered chart arrives classified by the template rules", async () => {
    const [a] = tenants;
    const groups = await prisma.account.findMany({ where: { companyId: a.companyId, code: { in: ["11", "12", "21", "22", "112", "114", "211", "5", "651", "72"] } } });
    const byCode = Object.fromEntries(groups.map((g) => [g.code, [g.liquidity, g.analysisRole]]));
    expect(byCode).toMatchObject({
      "11": ["current", null], "12": ["non_current", null], "21": ["current", null], "22": ["non_current", null],
      "112": [null, "receivables"], "114": [null, "inventory"], "211": [null, "payables"], "5": [null, "cost_of_sales"],
      "651": [null, "depreciation"], "72": [null, "finance_cost"],
    });
  });

  it("computes positions, flows and ratios for February from the posted entries", async () => {
    const body = await analysis(tenants[0], "2026-02-01", "2026-02-28");
    expect(body.days).toBe(28);
    expect(body.opening).toMatchObject({ totalAssets: 100_000, currentAssets: 100_000, equity: 100_000, totalLiabilities: 0 });
    expect(body.closing).toMatchObject({
      cash: 118_500, receivables: 50_000, inventory: 10_000, currentAssets: 178_500, totalAssets: 178_500,
      payables: 40_000, currentLiabilities: 40_000, nonCurrentLiabilities: 20_000, totalLiabilities: 60_000, equity: 118_500,
    });
    expect(body.flow).toMatchObject({ revenue: 50_000, costOfSales: 30_000, grossProfit: 20_000, financeCost: 1_000, depreciation: 500, netIncome: 18_500, ebit: 19_500, ebitda: 20_000 });
    expect(ratio(body, "currentRatio")).toBe(4.4625);
    expect(ratio(body, "quickRatio")).toBe(4.2125);
    expect(ratio(body, "cashRatio")).toBe(2.9625);
    expect(ratio(body, "workingCapital")).toBe(138_500);
    expect(ratio(body, "grossMargin")).toBe(0.4);
    expect(ratio(body, "netMargin")).toBe(0.37);
    expect(ratio(body, "returnOnAssets")).toBe(0.1329);
    expect(ratio(body, "returnOnEquity")).toBe(0.1693);
    expect(ratio(body, "receivableDays")).toBe(14);
    expect(ratio(body, "inventoryDays")).toBeCloseTo(4.6667, 4);
    expect(ratio(body, "payableDays")).toBeCloseTo(18.6667, 4);
    expect(ratio(body, "cashConversionCycle")).toBeCloseTo(0, 4);
    expect(ratio(body, "debtToEquity")).toBe(0.5063);
    expect(ratio(body, "interestCoverage")).toBe(19.5);
    expect(body.warnings).toEqual([]);
    expect(body.unclassifiedAccounts).toEqual([]);
  });

  it("keeps tenants with the same company name fully separate", async () => {
    const body = await analysis(tenants[1], "2026-02-01", "2026-02-28");
    expect(body.closing).toMatchObject({ totalAssets: 10_000, receivables: 3_000, cash: 7_000, currentLiabilities: 0 });
    expect(body.flow.revenue).toBe(3_000);
    // لا التزامات متداولة → النسبة غير معرَّفة، لا صفر ولا ما لا نهاية
    expect(ratio(body, "currentRatio")).toBeNull();
    expect(body.warnings).toContain("noCostOfSales");
    const other = await call(tenants[1].token, "GET", `/reports/financial-analysis?companyId=${tenants[0].companyId}&from=2026-02-01&to=2026-02-28`);
    expect(other.status).toBe(404);
  });

  it("flags an unclassified balance, then counts it once its group is classified — and audits the change", async () => {
    const [a] = tenants;
    const assets = await prisma.account.findFirstOrThrow({ where: { companyId: a.companyId, code: "1" } });
    const g2 = await call(a.token, "POST", "/accounts", { companyId: a.companyId, parentId: assets.id, name: `مجموعة اختبار ${stamp}`, type: "asset" });
    expect(g2.status, g2.text).toBe(201);
    expect(g2.body.liquidity).toBeNull();
    const g3 = await call(a.token, "POST", "/accounts", { companyId: a.companyId, parentId: g2.body.id, name: "فرعية اختبار", type: "asset" });
    expect(g3.status, g3.text).toBe(201);
    const leaf = await call(a.token, "POST", "/accounts", { companyId: a.companyId, parentId: g3.body.id, name: "حساب اختبار", type: "asset" });
    expect(leaf.status, leaf.text).toBe(201);
    a.acc.test = leaf.body.id;
    await post(a, "2026-03-05", "test", "cash", 2_000);

    let body = await analysis(a, "2026-03-01", "2026-03-31");
    expect(body.warnings).toContain("unclassifiedLiquidity");
    expect(body.unclassifiedAccounts).toEqual([expect.objectContaining({ accountId: leaf.body.id, amount: 2_000 })]);
    expect(body.closing.unclassifiedAssets).toBe(2_000);

    const patched = await call(a.token, "PATCH", `/accounts/${g2.body.id}`, { liquidity: "non_current" });
    expect(patched.status, patched.text).toBe(200);
    body = await analysis(a, "2026-03-01", "2026-03-31");
    expect(body.unclassifiedAccounts).toEqual([]);
    expect(body.closing.nonCurrentAssets).toBe(2_000);
    expect(body.closing.currentAssets).toBe(176_500);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: a.id, entityType: "Account", entityId: g2.body.id, action: "account.updated" } });
    expect((log.metadata as any).changes.liquidity).toEqual({ from: null, to: "non_current" });
  });

  it("rejects a classification that does not fit the account type", async () => {
    const [a] = tenants;
    const sales = await call(a.token, "PATCH", `/accounts/${a.acc.sales}`, { liquidity: "current" });
    expect(sales.status).toBe(400);
    const cash = await call(a.token, "PATCH", `/accounts/${a.acc.cash}`, { analysisRole: "cost_of_sales" });
    expect(cash.status).toBe(400);
  });

  it("rejects a missing company or an inverted period", async () => {
    const [a] = tenants;
    expect((await call(a.token, "GET", `/reports/financial-analysis?from=2026-02-01&to=2026-02-28`)).status).toBe(400);
    expect((await call(a.token, "GET", `/reports/financial-analysis?companyId=${a.companyId}&from=2026-03-01&to=2026-02-01`)).status).toBe(400);
  });
});
