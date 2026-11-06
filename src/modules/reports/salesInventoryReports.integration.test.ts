import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * تقارير المبيعات حسب الصنف/الفرع، المشتريات حسب الصنف، ملخص حركة المخزون، ومسودة إقرار الضريبة — عبر مسارات HTTP
 * الحقيقية: الأصناف والفواتير والمردودات تُنشأ وتُرحَّل بمساراتها، فالتكلفة وحركات المخزون هي ما ينتجه الترحيل نفسه.
 *
 *   05/07  شراء 100 وحدة × 10 (ضريبة 15%)          → مخزون 1,000
 *   10/07  بيع 30 وحدة × 25 (فرع الشمال)           → إيراد 750، تكلفة 300
 *   20/08  بيع 20 وحدة × 25 (بلا فرع)              → إيراد 500، تكلفة 200
 *   25/08  مردود 5 وحدات من فاتورة يوليو           → −125 إيراد (لا مخزون ولا تكلفة في النظام)
 *   12/08  بيع خدمة معفاة 200 (E)
 * مستأجر ثانٍ بالاسم نفسه ومبالغ مختلفة لكشف أي تسرّب.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emails = [`sir-a-${stamp}@example.com`, `sir-b-${stamp}@example.com`];
let server: Server;
let baseUrl = "";
type T = { id: string; token: string; companyId: string; customerId: string; supplierId: string; itemId: string; revenue: string; expense: string; warehouseId: string; branchId?: string };
const tenants: T[] = [];

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

async function setup(email: string) {
  const r = await register({ tenantName: `تقارير ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const token = r.accessToken;
  const customerId = (await call(token, "POST", "/customers", { companyId, name: "عميل" })).body.id;
  const supplierId = (await call(token, "POST", "/suppliers", { companyId, name: "مورد" })).body.id;
  const revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "411001" } })).id;
  const stock = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "114001" } })).id;
  const cogs = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "511001" } })).id;
  const item = await call(token, "POST", "/items", { companyId, code: `ITM-${stamp}`, name: "صنف اختبار", type: "inventory", unit: "حبة", salePrice: 25, stockAccountId: stock, cogsAccountId: cogs, revenueAccountId: revenue });
  expect(item.status, item.text).toBe(201);
  const expense = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "622001" } }).catch(() => prisma.account.findFirstOrThrow({ where: { companyId, type: "expense", isPosting: true, code: { startsWith: "62" } } }))).id;
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { companyId, isDefault: true } })).id;
  return { id: r.tenant.id, token, companyId, customerId, supplierId, itemId: item.body.id, revenue, expense, warehouseId };
}

async function sell(t: T, date: string, qty: number, branchId?: string) {
  const res = await call(t.token, "POST", "/sales-invoices", {
    companyId: t.companyId, customerId: t.customerId, date: `${date}T09:00:00.000Z`, post: true, branchId,
    lines: [{ accountId: t.revenue, itemId: t.itemId, description: "بيع", quantity: qty, unitPrice: 25, priceIncludesVat: false }],
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id ?? res.body.invoice?.id;
}

describe("sales, purchases, inventory and VAT return reports (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const email of emails) tenants.push(await setup(email));
    const [a, b] = tenants;

    const branch = await call(a.token, "POST", "/branches", { companyId: a.companyId, nameAr: "فرع الشمال", code: `N${stamp % 1000}`, country: "SA", currency: "SAR" });
    expect(branch.status, branch.text).toBe(201);
    a.branchId = branch.body.id;

    const pi = await call(a.token, "POST", "/purchase-invoices", {
      companyId: a.companyId, supplierId: a.supplierId, date: "2026-07-05T09:00:00.000Z", post: true,
      lines: [{ accountId: a.expense, itemId: a.itemId, warehouseId: a.warehouseId, description: "شراء", quantity: 100, unitPrice: 10, priceIncludesVat: false }],
    });
    expect(pi.status, pi.text).toBe(201);
    if (pi.body.status && pi.body.status !== "posted") expect((await call(a.token, "POST", `/purchase-invoices/${pi.body.id}/post`)).status).toBeLessThan(300);

    const july = await sell(a, "2026-07-10", 30, a.branchId);
    await sell(a, "2026-08-20", 20);
    const line = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: july } });
    const ret = await call(a.token, "POST", "/sales-returns", {
      companyId: a.companyId, customerId: a.customerId, relatedInvoiceId: july, date: "2026-08-25T09:00:00.000Z", refundMethod: "account", reason: "مرتجع",
      lines: [{ originalInvoiceLineId: line.id, accountId: a.revenue, description: "مرتجع", quantity: 5, unitPrice: 25, priceIncludesVat: false }],
    });
    expect(ret.status, ret.text).toBe(201);
    if (ret.body.status !== "posted") expect((await call(a.token, "POST", `/sales-returns/${ret.body.id}/post`)).status).toBe(200);

    const exempt = await call(a.token, "POST", "/sales-invoices", {
      companyId: a.companyId, customerId: a.customerId, date: "2026-08-12T09:00:00.000Z", post: true,
      lines: [{ accountId: a.revenue, description: "خدمة معفاة", quantity: 1, unitPrice: 200, priceIncludesVat: false, taxCategoryCode: "E", taxExemptionReasonCode: "VATEX-SA-29", taxExemptionReason: "خدمات مالية" }],
    });
    expect(exempt.status, exempt.text).toBe(201);

    const bpi = await call(b.token, "POST", "/purchase-invoices", {
      companyId: b.companyId, supplierId: b.supplierId, date: "2026-07-05T09:00:00.000Z", post: true,
      lines: [{ accountId: b.expense, itemId: b.itemId, warehouseId: b.warehouseId, description: "شراء", quantity: 7, unitPrice: 3, priceIncludesVat: false }],
    });
    expect(bpi.status, bpi.text).toBe(201);
  }, 180_000);

  afterAll(async () => {
    server?.close();
    for (const t of tenants) {
      await prisma.tenant.update({ where: { id: t.id }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: t.id } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: t.id } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  });

  it("sales by item nets returns and takes cost from the posted stock issues", async () => {
    const [a] = tenants;
    const res = await call(a.token, "GET", `/sales-reports/by-item?companyId=${a.companyId}&from=2026-07-01&to=2026-08-31`);
    expect(res.status, res.text).toBe(200);
    const row = res.body.find((r: any) => r.itemId === a.itemId);
    expect(row).toMatchObject({ quantity: 50, sales: 1_250, returnQuantity: 5, returns: 125, netQuantity: 45, netSales: 1_125, cost: 500, grossProfit: 625 });
    expect(row.margin).toBeCloseTo(0.5556, 4);
    // الخدمة المعفاة بلا صنف في صف مستقل
    expect(res.body.find((r: any) => r.itemId === null)).toMatchObject({ sales: 200, cost: 0 });
  });

  it("applies the date range and the branch filter", async () => {
    const [a] = tenants;
    const july = (await call(a.token, "GET", `/sales-reports/by-item?companyId=${a.companyId}&from=2026-07-01&to=2026-07-31`)).body;
    expect(july.find((r: any) => r.itemId === a.itemId)).toMatchObject({ quantity: 30, returns: 0, cost: 300 });
    const north = (await call(a.token, "GET", `/sales-reports/by-item?companyId=${a.companyId}&from=2026-07-01&to=2026-08-31&branchId=${a.branchId}`)).body;
    expect(north.find((r: any) => r.itemId === a.itemId)).toMatchObject({ quantity: 30, returnQuantity: 5, netSales: 625 });
    const branches = (await call(a.token, "GET", `/sales-reports/by-branch?companyId=${a.companyId}&from=2026-07-01&to=2026-08-31`)).body;
    expect(branches.find((r: any) => r.branchId === a.branchId)).toMatchObject({ invoiceCount: 1, sales: 750, returns: 125, netSales: 625 });
    expect(branches.find((r: any) => r.branchId === null)).toMatchObject({ invoiceCount: 2, sales: 700 });
    const byCustomer = (await call(a.token, "GET", `/sales-reports/by-customer?companyId=${a.companyId}&from=2026-08-01&to=2026-08-31`)).body;
    expect(byCustomer[0].invoiceCount).toBe(2);
    expect((await call(a.token, "GET", `/sales-reports/by-item?companyId=${a.companyId}&from=2026-08-31&to=2026-07-01`)).status).toBe(400);
  });

  it("purchases by item reports quantity, amount and average cost", async () => {
    const [a] = tenants;
    const res = await call(a.token, "GET", `/purchase-reports/by-item?companyId=${a.companyId}&from=2026-07-01&to=2026-07-31`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.rows.find((r: any) => r.itemId === a.itemId)).toMatchObject({ quantity: 100, amount: 1_000, averageCost: 10, invoiceCount: 1 });
  });

  it("inventory movement summary gives balances and values for any period from the movements", async () => {
    const [a] = tenants;
    const aug = await call(a.token, "GET", `/inventory-reports/movement-summary?companyId=${a.companyId}&from=2026-08-01&to=2026-08-31`);
    expect(aug.status, aug.text).toBe(200);
    expect(aug.body.find((r: any) => r.itemId === a.itemId)).toMatchObject({ openingQty: 70, openingValue: 700, inQty: 0, outQty: 20, outValue: 200, closingQty: 50, closingValue: 500 });
    const asOfJuly = (await call(a.token, "GET", `/inventory-reports/movement-summary?companyId=${a.companyId}&to=2026-07-31`)).body;
    const july = asOfJuly.find((r: any) => r.itemId === a.itemId);
    expect(july).toMatchObject({ openingQty: 0, inQty: 100, outQty: 30, closingQty: 70, closingValue: 700 });
    // آخر صرف 10/07 → 21 يوماً حتى 31/07
    expect(july.daysSinceLastOut).toBe(21);
  });

  it("drafts the VAT return by tax category with returns as adjustments", async () => {
    const [a] = tenants;
    const res = await call(a.token, "GET", `/vat-reconciliation/return?companyId=${a.companyId}&from=2026-07-01&to=2026-09-30`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.sales.S).toMatchObject({ base: 1_250, vat: 187.5, adjustmentBase: -125, adjustmentVat: -18.75, netBase: 1_125, netVat: 168.75 });
    expect(res.body.sales.E).toMatchObject({ base: 200, vat: 0 });
    expect(res.body.purchases.S).toMatchObject({ base: 1_000, vat: 150 });
    expect(res.body).toMatchObject({ totalOutputVat: 168.75, totalInputVat: 150, netVat: 18.75 });
  });

  it("keeps the same-named company of another tenant separate", async () => {
    const [a, b] = tenants;
    const own = (await call(b.token, "GET", `/inventory-reports/movement-summary?companyId=${b.companyId}&to=2026-12-31`)).body;
    expect(own.find((r: any) => r.itemId === b.itemId)).toMatchObject({ closingQty: 7, closingValue: 21 });
    const foreign = await call(b.token, "GET", `/inventory-reports/movement-summary?companyId=${a.companyId}&to=2026-12-31`);
    expect(foreign.status === 403 || (foreign.status === 200 && foreign.body.length === 0)).toBe(true);
    const foreignSales = await call(b.token, "GET", `/sales-reports/by-item?companyId=${a.companyId}`);
    expect(foreignSales.status === 403 || (foreignSales.status === 200 && foreignSales.body.length === 0)).toBe(true);
  });
});
