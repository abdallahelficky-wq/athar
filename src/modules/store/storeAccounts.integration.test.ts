import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { otpDelivery, OTP_MAX_ATTEMPTS } from "./storeAuth.service";

/**
 * حسابات عملاء المتجر وطلباتهم — عبر HTTP على مُخرَجات النظام نفسها (القاعدة 2): المتجر والأصناف والمخزون تُنشأ من مسارات
 * أثر المصادَقة، والرمز يولّده النظام نفسه ويُلتقَط عند قناة الإرسال (otpDelivery.send — البديل الوحيد المصنوع: رد Meta،
 * مدخل خارجي). مستأجران لكلٍّ متجره (القاعدة 4): رمز عميل متجر لا يعمل على متجر آخر، وطلبات شركة لا يراها مستأجر آخر.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
type Session = { token: string; tenantId: string; companyId: string; slug: string };
let a: Session;
let b: Session;
const sentCodes = new Map<string, string>();
const originalDelivery = { ...otpDelivery };

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
  const r = await register({ tenantName: `حسابات المتجر ${label} ${stamp}`, businessActivity: "retail", name: "المالك", email: `store-acc-${label}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const slug = `acc-${label}-${stamp}`;
  const enabled = await call(r.accessToken, "PATCH", `/companies/${companyId}`, { storeEnabled: true, storeSlug: slug });
  expect(enabled.status, enabled.text).toBe(200);
  return { token: r.accessToken, tenantId: r.tenant.id, companyId, slug };
}

async function createItem(s: Session, body: Record<string, unknown>, stock: number) {
  const account = async (type: "asset" | "expense" | "revenue") => (await prisma.account.findFirstOrThrow({ where: { companyId: s.companyId, type, isPosting: true } })).id;
  const res = await call(s.token, "POST", "/items", {
    companyId: s.companyId, type: "inventory", publishedInStore: true, priceIncludesVat: false,
    stockAccountId: await account("asset"), cogsAccountId: await account("expense"), revenueAccountId: await account("revenue"), ...body,
  });
  expect(res.status, res.text).toBe(201);
  if (stock > 0) {
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { companyId: s.companyId, isDefault: true } })).id;
    const moved = await call(s.token, "POST", "/stock-movements/in-out", { type: "in", itemId: res.body.id, warehouseId, quantity: stock, unitCost: 10, date: "2026-10-01" });
    expect(moved.status, moved.text).toBe(201);
  }
}

// أرقام جوال سعودية مختلفة لكل حالة — حدّ "رمز كل دقيقة" لكل جوال
const phone = (n: number) => `05${String(stamp % 10_000_000).padStart(7, "0")}${n}`;
const intl = (local: string) => `966${local.slice(1)}`;

async function login(s: Session, local: string) {
  const requested = await call(null, "POST", `/store/${s.slug}/auth/request-otp`, { phone: local });
  expect(requested.status, requested.text).toBe(200);
  const verified = await call(null, "POST", `/store/${s.slug}/auth/verify-otp`, { phone: local, code: sentCodes.get(intl(local)) });
  expect(verified.status, verified.text).toBe(200);
  return verified.body.token as string;
}

describe("store customer accounts (mobile OTP) and orders", () => {
  beforeAll(async () => {
    otpDelivery.enabled = () => true;
    otpDelivery.send = async (to, code) => { sentCodes.set(to, code); return { ok: true }; };
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await open("a");
    b = await open("b");
    await createItem(a, { code: `BOLT-${stamp}`, name: "ترباس", salePrice: 35 }, 5);
    await createItem(a, { code: `EMPTY-${stamp}`, name: "بلا رصيد", salePrice: 20 }, 0);
    await createItem(b, { code: `OTHER-${stamp}`, name: "صنف شركة أخرى", salePrice: 50 }, 5);
  }, 120_000);

  afterAll(() => {
    Object.assign(otpDelivery, originalDelivery);
    server?.close();
  });

  it("issues a one-time code, limits re-requests, and accepts the code once", async () => {
    const local = phone(1);
    expect((await call(null, "POST", `/store/${a.slug}/auth/request-otp`, { phone: "12345" })).status).toBe(400);

    const requested = await call(null, "POST", `/store/${a.slug}/auth/request-otp`, { phone: local });
    expect(requested.status, requested.text).toBe(200);
    const code = sentCodes.get(intl(local))!;
    expect(code).toMatch(/^\d{6}$/);
    // الرمز لا يعود في الرد ولا يُخزَّن نصاً
    expect(requested.text).not.toContain(code);
    expect((await prisma.storeOtp.findFirstOrThrow({ where: { companyId: a.companyId, phone: intl(local) } })).codeHash).not.toContain(code);
    // طلب ثانٍ خلال الدقيقة مرفوض
    expect((await call(null, "POST", `/store/${a.slug}/auth/request-otp`, { phone: local })).status).toBe(429);

    const wrong = code === "000000" ? "000001" : "000000";
    expect((await call(null, "POST", `/store/${a.slug}/auth/verify-otp`, { phone: local, code: wrong })).status).toBe(401);
    // الرمز الصحيح على متجر آخر لا يعمل
    expect((await call(null, "POST", `/store/${b.slug}/auth/verify-otp`, { phone: local, code })).status).toBe(401);

    const verified = await call(null, "POST", `/store/${a.slug}/auth/verify-otp`, { phone: local, code });
    expect(verified.status, verified.text).toBe(200);
    expect(verified.body.customer).toEqual({ phone: intl(local), name: null, city: null });
    // لا يُستخدَم الرمز مرتين
    expect((await call(null, "POST", `/store/${a.slug}/auth/verify-otp`, { phone: local, code })).status).toBe(401);

    const token = verified.body.token as string;
    expect((await call(token, "GET", `/store/${a.slug}/me`)).status).toBe(200);
    // رمز عميل متجر (أ) لا يُقبَل على متجر (ب) ولا على مسارات مستخدمي أثر
    expect((await call(token, "GET", `/store/${b.slug}/me`)).status).toBe(401);
    expect((await call(token, "GET", `/items?companyId=${a.companyId}`)).status).toBe(401);
    // ورمز مستخدم أثر ليس رمز عميل متجر
    expect((await call(a.token, "GET", `/store/${a.slug}/me`)).status).toBe(401);
    expect((await call(null, "GET", `/store/${a.slug}/me`)).status).toBe(401);
  });

  it("locks a code after too many wrong attempts, even for the right code", async () => {
    const local = phone(2);
    expect((await call(null, "POST", `/store/${a.slug}/auth/request-otp`, { phone: local })).status).toBe(200);
    const code = sentCodes.get(intl(local))!;
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect((await call(null, "POST", `/store/${a.slug}/auth/verify-otp`, { phone: local, code: wrong })).status).toBe(401);
    }
    expect((await call(null, "POST", `/store/${a.slug}/auth/verify-otp`, { phone: local, code })).status).toBe(401);
  });

  it("records an order with server-side prices, for a guest and for a signed-in customer", async () => {
    const guest = await call(null, "POST", `/store/${a.slug}/orders`, {
      customer: { name: "زائر", phone: phone(3), city: "جدة" },
      // سعر واسم يرسلهما العميل يُتجاهَلان — الخادم يقرأ الصنف
      lines: [{ code: `BOLT-${stamp}`, quantity: 2, unitPrice: 1, name: "مزوّر" }],
    });
    expect(guest.status, guest.text).toBe(201);
    expect(guest.body).toMatchObject({ number: 1, status: "new", subtotal: 70, vat: 10.5, total: 80.5, customerName: "زائر", phone: intl(phone(3)), city: "جدة" });
    expect(guest.body.lines).toEqual([{ code: `BOLT-${stamp}`, name: "ترباس", nameEn: null, quantity: 2, unitPrice: 40.25, priceExVat: 35, lineTotal: 80.5 }]);
    expect(guest.text).not.toContain("مزوّر");

    const token = await login(a, phone(4));
    const mine = await call(token, "POST", `/store/${a.slug}/orders`, { customer: { name: "عميل", phone: phone(4), city: "مكة", notes: "اتصل قبل التوصيل" }, lines: [{ code: `BOLT-${stamp}`, quantity: 1 }] });
    expect(mine.status, mine.text).toBe(201);
    expect(mine.body).toMatchObject({ number: 2, total: 40.25, notes: "اتصل قبل التوصيل" });

    // العميل يرى طلباته فقط — لا طلب الزائر
    const listed = await call(token, "GET", `/store/${a.slug}/orders`);
    expect(listed.status, listed.text).toBe(200);
    expect(listed.body.map((o: { number: number }) => o.number)).toEqual([2]);
    // وبيانات الطلب صارت بيانات حسابه
    expect((await call(token, "GET", `/store/${a.slug}/me`)).body).toEqual({ phone: intl(phone(4)), name: "عميل", city: "مكة" });
    // طلب برمز غير صالح يُرفَض ولا يُسجَّل كزائر
    expect((await call("not-a-token", "POST", `/store/${a.slug}/orders`, { customer: { name: "س", phone: phone(4), city: "جدة" }, lines: [{ code: `BOLT-${stamp}`, quantity: 1 }] })).status).toBe(401);
  });

  it("rejects an order with another company's item, an out-of-stock item, no lines or no customer details", async () => {
    const customer = { name: "زائر", phone: phone(5), city: "جدة" };
    expect((await call(null, "POST", `/store/${a.slug}/orders`, { customer, lines: [{ code: `OTHER-${stamp}`, quantity: 1 }] })).status).toBe(409);
    expect((await call(null, "POST", `/store/${a.slug}/orders`, { customer, lines: [{ code: `BOLT-${stamp}`, quantity: 1 }, { code: `EMPTY-${stamp}`, quantity: 1 }] })).status).toBe(409);
    expect((await call(null, "POST", `/store/${a.slug}/orders`, { customer, lines: [] })).status).toBe(400);
    expect((await call(null, "POST", `/store/${a.slug}/orders`, { customer: { name: "زائر", city: "جدة" }, lines: [{ code: `BOLT-${stamp}`, quantity: 1 }] })).status).toBe(400);
    // لا طلب سُجِّل من المحاولات المرفوضة، ولا رقم استُهلك
    expect(await prisma.storeOrder.count({ where: { companyId: a.companyId } })).toBe(2);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: a.companyId } })).storeNextOrderSeq).toBe(3);
  });

  it("lets the company follow its own store orders from Athar, and no other tenant", async () => {
    const own = await call(a.token, "GET", `/store-orders?companyId=${a.companyId}`);
    expect(own.status, own.text).toBe(200);
    expect(own.body.map((o: { number: number }) => o.number)).toEqual([2, 1]);

    const foreign = await call(b.token, "GET", `/store-orders?companyId=${a.companyId}`);
    expect(foreign.status === 200 ? foreign.body : []).toEqual([]);

    const orderId = own.body[0].id as string;
    expect((await call(b.token, "PATCH", `/store-orders/${orderId}/status`, { status: "cancelled" })).status).toBe(404);
    expect((await prisma.storeOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("new");

    const confirmed = await call(a.token, "PATCH", `/store-orders/${orderId}/status`, { status: "confirmed" });
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body.status).toBe("confirmed");
    expect((await call(a.token, "PATCH", `/store-orders/${orderId}/status`, { status: "shipped" })).status).toBe(400);
    expect((await call(null, "GET", `/store-orders?companyId=${a.companyId}`)).status).toBe(401);
  });

  it("turns sign-in off when no OTP channel is configured, while the store and guest orders keep working", async () => {
    otpDelivery.enabled = () => false;
    try {
      expect((await call(null, "GET", `/store/${a.slug}`)).body.loginEnabled).toBe(false);
      expect((await call(null, "POST", `/store/${a.slug}/auth/request-otp`, { phone: phone(6) })).status).toBe(503);
      expect(await prisma.storeOtp.count({ where: { companyId: a.companyId, phone: intl(phone(6)) } })).toBe(0);
    } finally {
      otpDelivery.enabled = () => true;
    }
    expect((await call(null, "GET", `/store/${a.slug}`)).body.loginEnabled).toBe(true);
  });
});
