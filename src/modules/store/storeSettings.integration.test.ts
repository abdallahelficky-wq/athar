import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * إعدادات المتجر: الشحن والدفع والكوبونات والسعر قبل الخصم وخلاصة المنتجات — عبر HTTP على مُخرَجات النظام نفسها (القاعدة 2):
 * الإعدادات والمناطق والكوبونات والأصناف والمخزون تُنشأ من مسارات أثر المصادَقة، والطلب وعرض السعر من مسارات المتجر العام.
 * المصنوع يدوياً صف مرفق الصورة فقط: الملف نفسه في تخزين خارجي (R2) لا يُرفَع في الاختبار.
 * مستأجران لكلٍّ متجره (القاعدة 4): مناطق وكوبونات شركة لا تعمل في متجر أخرى ولا يديرها مستأجر آخر.
 * أسعار الأصناف قبل الضريبة 15%: 35 → 40.25 شامل.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
type Session = { token: string; tenantId: string; companyId: string; slug: string };
let a: Session;
let b: Session;
const BOLT = `BOLT-${stamp}`;
const CHEAP = `CHEAP-${stamp}`;

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

async function open(label: string, settings: Record<string, unknown>): Promise<Session> {
  const r = await register({ tenantName: `إعدادات المتجر ${label} ${stamp}`, businessActivity: "retail", name: "المالك", email: `store-set-${label}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const slug = `set-${label}-${stamp}`;
  const enabled = await call(r.accessToken, "PATCH", `/companies/${companyId}`, { storeEnabled: true, storeSlug: slug, ...settings });
  expect(enabled.status, enabled.text).toBe(200);
  return { token: r.accessToken, tenantId: r.tenant.id, companyId, slug };
}

async function createItem(s: Session, body: Record<string, unknown>, stock = 20) {
  const account = async (type: "asset" | "expense" | "revenue") => (await prisma.account.findFirstOrThrow({ where: { companyId: s.companyId, type, isPosting: true } })).id;
  const res = await call(s.token, "POST", "/items", {
    companyId: s.companyId, type: "inventory", publishedInStore: true, priceIncludesVat: false,
    stockAccountId: await account("asset"), cogsAccountId: await account("expense"), revenueAccountId: await account("revenue"), ...body,
  });
  expect(res.status, res.text).toBe(201);
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { companyId: s.companyId, isDefault: true } })).id;
  const moved = await call(s.token, "POST", "/stock-movements/in-out", { type: "in", itemId: res.body.id, warehouseId, quantity: stock, unitCost: 10, date: "2026-10-01" });
  expect(moved.status, moved.text).toBe(201);
  return res.body.id as string;
}

const customer = (city: string) => ({ name: "عميل", phone: "0501234567", city });
const order = (s: Session, body: Record<string, unknown>) => call(null, "POST", `/store/${s.slug}/orders`, body);
const quote = (s: Session, body: Record<string, unknown>) => call(null, "POST", `/store/${s.slug}/quote`, body);
let zoneA = "";
let boltId = "";

describe("store settings: shipping, payment, coupons, compare-at price, product feed", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await open("a", { storePickupEnabled: true, storePickupAddress: "جدة — المعرض", storeBankTransferEnabled: true, storeBankTransferDetails: "IBAN SA00", storeFreeShippingOver: 500, storeMinOrderAmount: 30, storeAccentColor: "#0a7d5a", storeMetaPixelId: "1234567890", storeSocial: { instagram: "https://instagram.com/x" } });
    b = await open("b", { storeCodEnabled: false, storeBankTransferEnabled: true });
    boltId = await createItem(a, { code: BOLT, name: "ترباس", salePrice: 35, storeCompareAtPrice: 50, storeFeatured: true });
    await createItem(a, { code: CHEAP, name: "رخيص", salePrice: 20, storeCompareAtPrice: 10 });
    await createItem(b, { code: BOLT, name: "ترباس الشركة الأخرى", salePrice: 100 });

    const zone = async (s: Session, city: string, fee: number) => {
      const res = await call(s.token, "POST", "/store-admin/shipping-zones", { companyId: s.companyId, city, fee });
      expect(res.status, res.text).toBe(201);
      return res.body.id as string;
    };
    zoneA = await zone(a, "جدة", 23);
    await zone(a, "الرياض", 34.5);
    await zone(b, "الدمام", 99);
    const coupon = async (s: Session, body: Record<string, unknown>) => expect((await call(s.token, "POST", "/store-admin/coupons", { companyId: s.companyId, ...body })).status).toBe(201);
    await coupon(a, { code: "ten", type: "percent", value: 10, maxUses: 1 });
    await coupon(a, { code: "BIGMIN", type: "fixed", value: 5, minOrderAmount: 1000 });
    await coupon(a, { code: "OLD", type: "fixed", value: 5, expiresAt: "2020-01-01" });
    await coupon(b, { code: "BONLY", type: "fixed", value: 5 });
  }, 120_000);

  afterAll(() => server?.close());

  it("publishes the store's own appearance, shipping and payment settings", async () => {
    const res = await call(null, "GET", `/store/${a.slug}`);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({
      accentColor: "#0a7d5a", metaPixelId: "1234567890", social: { instagram: "https://instagram.com/x" },
      shipping: { zones: [{ city: "الرياض", fee: 34.5 }, { city: "جدة", fee: 23 }], freeOver: 500, pickupEnabled: true, pickupAddress: "جدة — المعرض" },
      payment: { cod: true, bankTransfer: true, bankTransferDetails: "IBAN SA00" }, minOrderAmount: 30,
    });
    const other = await call(null, "GET", `/store/${b.slug}`);
    expect(other.body.shipping.zones).toEqual([{ city: "الدمام", fee: 99 }]);
    expect(other.body.payment).toMatchObject({ cod: false, bankTransfer: true });
  });

  it("shows a compare-at price only when it is above the selling price, both VAT-inclusive", async () => {
    const bolt = await call(null, "GET", `/store/${a.slug}/products/${BOLT}`);
    expect(bolt.body).toMatchObject({ price: 40.25, compareAtPrice: 57.5, featured: true });
    const cheap = await call(null, "GET", `/store/${a.slug}/products/${CHEAP}`);
    expect(cheap.body).toMatchObject({ price: 23, compareAtPrice: null, featured: false });
    // المميَّز أولاً في الترتيب الافتراضي
    expect((await call(null, "GET", `/store/${a.slug}/products`)).body.products[0].code).toBe(BOLT);
  });

  it("quotes the shipping fee of the chosen city and the coupon discount", async () => {
    const lines = [{ code: BOLT, quantity: 2 }];
    expect((await quote(a, { lines, customer: { city: "جدة" } })).body).toMatchObject({ itemsTotal: 80.5, shippingFee: 23, discount: 0, total: 103.5, vat: 13.5, cityNotServed: false });
    expect((await quote(a, { lines, customer: { city: "الرياض" }, couponCode: "Ten" })).body).toMatchObject({ discount: 8.05, shippingFee: 34.5, total: 106.95, couponCode: "TEN" });
    expect((await quote(a, { lines, shippingMethod: "pickup" })).body).toMatchObject({ shippingFee: 0, total: 80.5, shippingMethod: "pickup" });
    expect((await quote(a, { lines, customer: { city: "الدمام" } })).body).toMatchObject({ cityNotServed: true, shippingFee: 0 });
    // شحن مجاني عند 500: 13 × 40.25 = 523.25
    expect((await quote(a, { lines: [{ code: BOLT, quantity: 13 }], customer: { city: "جدة" } })).body).toMatchObject({ freeShipping: true, shippingFee: 0, total: 523.25 });
    expect((await quote(a, { lines: [{ code: CHEAP, quantity: 1 }], customer: { city: "جدة" } })).body.belowMinimum).toBe(true);
  });

  it("rejects coupons that are unknown, expired, below their minimum, or another store's", async () => {
    const lines = [{ code: BOLT, quantity: 2 }];
    for (const code of ["NOPE", "OLD", "BONLY"]) expect((await quote(a, { lines, couponCode: code })).status, code).toBe(400);
    expect((await quote(a, { lines, couponCode: "BIGMIN" })).status).toBe(400);
    expect((await quote(b, { lines: [{ code: BOLT, quantity: 1 }], couponCode: "TEN" })).status).toBe(400);
  });

  it("records an order with server-computed shipping, discount and payment, and counts the coupon once", async () => {
    const lines = [{ code: BOLT, quantity: 2 }];
    const done = await order(a, { lines, customer: customer("جدة"), couponCode: "ten", paymentMethod: "bank_transfer", shippingFee: 0, discountAmount: 80 });
    expect(done.status, done.text).toBe(201);
    expect(done.body).toMatchObject({ shippingMethod: "delivery", shippingFee: 23, paymentMethod: "bank_transfer", discountAmount: 8.05, couponCode: "TEN", total: 95.45, city: "جدة" });
    expect(done.body.subtotal + done.body.vat).toBeCloseTo(95.45, 2);
    // maxUses = 1: الاستخدام الثاني يُرفَض ولا يُسجَّل طلب
    const before = await prisma.storeOrder.count({ where: { companyId: a.companyId } });
    expect((await order(a, { lines, customer: customer("جدة"), couponCode: "TEN" })).status).toBe(400);
    expect(await prisma.storeOrder.count({ where: { companyId: a.companyId } })).toBe(before);
    expect((await prisma.storeCoupon.findFirstOrThrow({ where: { companyId: a.companyId, code: "TEN" } })).usedCount).toBe(1);
  });

  it("enforces served cities, pickup, payment methods and the minimum order", async () => {
    const lines = [{ code: BOLT, quantity: 2 }];
    expect((await order(a, { lines, customer: customer("الدمام") })).status).toBe(400);
    expect((await order(a, { lines: [{ code: CHEAP, quantity: 1 }], customer: customer("جدة") })).status).toBe(400);
    const pickup = await order(a, { lines, customer: { name: "عميل", phone: "0501234567" }, shippingMethod: "pickup" });
    expect(pickup.status, pickup.text).toBe(201);
    expect(pickup.body).toMatchObject({ shippingMethod: "pickup", shippingFee: 0, paymentMethod: "cod", total: 80.5 });
    // المتجر الآخر: لا استلام، ولا دفع عند الاستلام
    const bLines = [{ code: BOLT, quantity: 1 }];
    expect((await order(b, { lines: bLines, customer: customer("الدمام"), shippingMethod: "pickup", paymentMethod: "bank_transfer" })).status).toBe(400);
    expect((await order(b, { lines: bLines, customer: customer("الدمام") })).status).toBe(400);
    const ok = await order(b, { lines: bLines, customer: customer("الدمام"), paymentMethod: "bank_transfer" });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body).toMatchObject({ shippingFee: 99, total: 214 });
  });

  it("keeps shipping zones and coupons inside their own tenant", async () => {
    expect((await call(b.token, "GET", `/store-admin/shipping-zones?companyId=${a.companyId}`)).body).toEqual([]);
    expect((await call(b.token, "GET", `/store-admin/coupons?companyId=${a.companyId}`)).body).toEqual([]);
    expect((await call(b.token, "PATCH", `/store-admin/shipping-zones/${zoneA}`, { fee: 1 })).status).toBe(404);
    expect((await call(b.token, "DELETE", `/store-admin/shipping-zones/${zoneA}`)).status).toBe(404);
    expect((await call(b.token, "POST", "/store-admin/shipping-zones", { companyId: a.companyId, city: "مكة", fee: 1 })).status).toBe(400);
    expect((await call(b.token, "POST", "/store-admin/coupons", { companyId: a.companyId, code: "HACK", type: "percent", value: 100 })).status).toBe(400);
    const couponA = await prisma.storeCoupon.findFirstOrThrow({ where: { companyId: a.companyId, code: "TEN" } });
    expect((await call(b.token, "PATCH", `/store-admin/coupons/${couponA.id}`, { maxUses: 99 })).status).toBe(404);
    expect((await call(null, "GET", `/store-admin/coupons?companyId=${a.companyId}`)).status).toBe(401);
    expect(Number((await prisma.storeShippingZone.findUniqueOrThrow({ where: { id: zoneA } })).fee)).toBe(23);
    // تكرار المدينة والرمز داخل الشركة نفسها مرفوض، ونسبة فوق 100 مرفوضة
    expect((await call(a.token, "POST", "/store-admin/shipping-zones", { companyId: a.companyId, city: "جدة", fee: 5 })).status).toBe(409);
    expect((await call(a.token, "POST", "/store-admin/coupons", { companyId: a.companyId, code: "TEN", type: "fixed", value: 1 })).status).toBe(409);
    expect((await call(a.token, "POST", "/store-admin/coupons", { companyId: a.companyId, code: "OVER", type: "percent", value: 150 })).status).toBe(400);
  });

  it("feeds Meta only the store's own published products that have an image, with the strike-through price", async () => {
    const empty = await call(null, "GET", `/store/${a.slug}/feed.csv`);
    expect(empty.status).toBe(200);
    expect(empty.text.trim().split("\r\n")).toHaveLength(1);
    const image = await prisma.attachment.create({ data: { tenantId: a.tenantId, entityType: "item_store_image", entityId: boltId, fileName: "x.png", fileKey: `${a.tenantId}/x/${boltId}/x.png`, fileSize: 1, mimeType: "image/png" } });
    const feed = (await call(null, "GET", `/store/${a.slug}/feed.csv`)).text.trim().split("\r\n");
    expect(feed).toHaveLength(2);
    expect(feed[0]).toBe("id,title,description,availability,condition,price,sale_price,link,image_link,brand");
    expect(feed[1]).toContain(`"${BOLT}","ترباس","ترباس","in stock","new","57.50 SAR","40.25 SAR"`);
    expect(feed[1]).toContain(`/store/${a.slug}/product/${BOLT}"`);
    expect(feed[1]).toContain(`/api/store/${a.slug}/images/${image.id}"`);
    expect((await call(null, "GET", `/store/${b.slug}/feed.csv`)).text).not.toContain(image.id);
  });
});
