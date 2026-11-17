import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { phoneVariants } from "./storeOrderInvoice.service";

/**
 * إصدار فاتورة مبيعات (مسودة) من طلب متجر — عبر HTTP من أول الطلب العام إلى الفاتورة (القاعدة 2): الصنف والمخزون ومنطقة
 * الشحن والكوبون من مسارات أثر، الطلب من المتجر العام، والفاتورة تُقرأ من مسار فواتير المبيعات نفسه.
 * مستأجران (القاعدة 4): لا يُصدر مستأجر فاتورة لطلب غيره، ولا يُقبَل حساب شحن من شركة أخرى.
 * الصنف 35 قبل الضريبة = 40.25 شامل؛ الطلب: 2 × 40.25 − خصم 10% (8.05) + شحن 23 = 95.45.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
type Session = { token: string; tenantId: string; companyId: string; slug: string; revenueAccountId: string };
let a: Session;
let b: Session;
const CODE = `INV-ITEM-${stamp}`;
const PHONE = "0501234567";

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ليس JSON */ }
  return { status: res.status, body: parsed, text };
}

async function open(label: string): Promise<Session> {
  const r = await register({ tenantName: `فوترة الطلبات ${label} ${stamp}`, businessActivity: "retail", name: "المالك", email: `store-inv-${label}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const slug = `inv-${label}-${stamp}`;
  expect((await call(r.accessToken, "PATCH", `/companies/${companyId}`, { storeEnabled: true, storeSlug: slug })).status).toBe(200);
  const account = async (type: "asset" | "expense" | "revenue") => (await prisma.account.findFirstOrThrow({ where: { companyId, type, isPosting: true } })).id;
  const revenueAccountId = await account("revenue");
  const item = await call(r.accessToken, "POST", "/items", {
    companyId, type: "inventory", publishedInStore: true, priceIncludesVat: false, code: CODE, name: "ترباس", salePrice: 35,
    stockAccountId: await account("asset"), cogsAccountId: await account("expense"), revenueAccountId,
  });
  expect(item.status, item.text).toBe(201);
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { companyId, isDefault: true } })).id;
  expect((await call(r.accessToken, "POST", "/stock-movements/in-out", { type: "in", itemId: item.body.id, warehouseId, quantity: 50, unitCost: 10, date: "2026-10-01" })).status).toBe(201);
  expect((await call(r.accessToken, "POST", "/store-admin/shipping-zones", { companyId, city: "جدة", fee: 23 })).status).toBe(201);
  expect((await call(r.accessToken, "POST", "/store-admin/coupons", { companyId, code: "TEN", type: "percent", value: 10 })).status).toBe(201);
  return { token: r.accessToken, tenantId: r.tenant.id, companyId, slug, revenueAccountId };
}

async function placeOrder(s: Session, extra: Record<string, unknown> = {}) {
  const res = await call(null, "POST", `/store/${s.slug}/orders`, { customer: { name: "عميل المتجر", phone: PHONE, city: "جدة" }, lines: [{ code: CODE, quantity: 2 }], ...extra });
  expect(res.status, res.text).toBe(201);
  const order = await prisma.storeOrder.findFirstOrThrow({ where: { companyId: s.companyId, number: res.body.number } });
  return order.id;
}

describe("store order → draft sales invoice", () => {
  let orderId = "";
  let invoiceId = "";

  beforeAll(async () => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await open("a");
    b = await open("b");
    orderId = await placeOrder(a, { couponCode: "TEN" });
  }, 120_000);

  afterAll(() => server?.close());

  it("needs a shipping revenue account of the same company for an order with a shipping fee", async () => {
    expect((await call(a.token, "POST", `/store-orders/${orderId}/invoice`, {})).status).toBe(400);
    expect((await call(a.token, "POST", `/store-orders/${orderId}/invoice`, { shippingAccountId: b.revenueAccountId })).status).toBe(400);
    expect(await prisma.salesInvoice.count({ where: { companyId: a.companyId } })).toBe(0);
  });

  it("refuses another tenant and an unauthenticated caller", async () => {
    expect((await call(b.token, "POST", `/store-orders/${orderId}/invoice`, { shippingAccountId: b.revenueAccountId })).status).toBe(404);
    expect((await call(null, "POST", `/store-orders/${orderId}/invoice`, {})).status).toBe(401);
    expect(await prisma.salesInvoice.count({ where: { tenantId: { in: [a.tenantId, b.tenantId] } } })).toBe(0);
  });

  it("creates a draft invoice with the order's prices, discount and shipping, a new customer, and links the order", async () => {
    const res = await call(a.token, "POST", `/store-orders/${orderId}/invoice`, { shippingAccountId: a.revenueAccountId });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ invoiceTotal: 95.45, orderTotal: 95.45, difference: 0, customerCreated: true });
    expect(res.body.order).toMatchObject({ status: "confirmed", salesInvoice: { id: res.body.invoiceId, invoiceNumber: res.body.invoiceNumber, status: "draft" } });
    invoiceId = res.body.invoiceId;

    const invoice = await call(a.token, "GET", `/sales-invoices/${invoiceId}`);
    expect(invoice.status, invoice.text).toBe(200);
    expect(invoice.body).toMatchObject({ status: "draft", companyId: a.companyId, customerReference: expect.stringContaining("طلب متجر رقم") });
    expect(Number(invoice.body.grandTotal)).toBe(95.45);
    expect(invoice.body.lines).toHaveLength(2);
    expect(invoice.body.customer).toMatchObject({ name: "عميل المتجر", customerType: "individual" });
    // مسودة: لا قيد محاسبي ولا حركة مخزون صرف
    expect(await prisma.journalEntry.count({ where: { companyId: a.companyId, sourceId: invoiceId } })).toBe(0);
    // القائمة تعرض الربط
    const list = await call(a.token, "GET", `/store-orders?companyId=${a.companyId}`);
    expect(list.body.find((o: any) => o.id === orderId).salesInvoice.invoiceNumber).toBe(res.body.invoiceNumber);
  });

  it("issues one invoice per order and reuses the customer with the same mobile", async () => {
    expect((await call(a.token, "POST", `/store-orders/${orderId}/invoice`, { shippingAccountId: a.revenueAccountId })).status).toBe(409);
    const second = await placeOrder(a);
    const res = await call(a.token, "POST", `/store-orders/${second}/invoice`, { shippingAccountId: a.revenueAccountId });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ invoiceTotal: 103.5, difference: 0, customerCreated: false });
    const stored = (await prisma.storeOrder.findUniqueOrThrow({ where: { id: second } })).phone;
    expect(await prisma.customer.count({ where: { companyId: a.companyId, phone: { in: phoneVariants(stored) } } })).toBe(1);
    expect(await prisma.customer.count({ where: { companyId: b.companyId } })).toBe(0);
  });

  it("refuses a cancelled order, and frees the order when its draft invoice is deleted", async () => {
    const third = await placeOrder(a);
    expect((await call(a.token, "PATCH", `/store-orders/${third}/status`, { status: "cancelled" })).status).toBe(200);
    expect((await call(a.token, "POST", `/store-orders/${third}/invoice`, { shippingAccountId: a.revenueAccountId })).status).toBe(400);

    expect((await call(a.token, "DELETE", `/sales-invoices/${invoiceId}`)).status).toBe(204);
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } })).salesInvoiceId).toBeNull();
    const again = await call(a.token, "POST", `/store-orders/${orderId}/invoice`, { shippingAccountId: a.revenueAccountId });
    expect(again.status, again.text).toBe(201);
    expect(again.body.invoiceId).not.toBe(invoiceId);
  });
});
