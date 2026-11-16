import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * المتجر الإلكتروني العام — عزل وحدود ما يُعرَض، على مُخرَجات النظام نفسها (القاعدة 2): المتجر يُفعَّل من PATCH /api/companies،
 * والأصناف تُنشأ وتُنشر من POST/PATCH /api/items، والمخزون من POST /api/stock-movements/in-out، ثم تُقرأ الردود العامة من
 * GET /api/store/* بلا أي رمز دخول. مستأجران لكلٍّ شركة ومتجر (القاعدة 4): لا يخرج من متجر صنف شركة أخرى ولا حقل تكلفة.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";

type Session = { token: string; tenantId: string; companyId: string; slug: string; accounts: { stockAccountId: string; cogsAccountId: string; revenueAccountId: string } };
let a: Session;
let b: Session;

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    redirect: "manual",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ليس JSON */ }
  return { status: res.status, body: parsed, text };
}
const pub = (url: string) => call(null, "GET", url);

async function open(label: string): Promise<Session> {
  const r = await register({ tenantName: `متجر ${label} ${stamp}`, businessActivity: "retail", name: "المالك", email: `store-${label}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const account = async (type: "asset" | "expense" | "revenue") => (await prisma.account.findFirstOrThrow({ where: { companyId, type, isPosting: true } })).id;
  return {
    token: r.accessToken,
    tenantId: r.tenant.id,
    companyId,
    slug: `shop-${label}-${stamp}`,
    accounts: { stockAccountId: await account("asset"), cogsAccountId: await account("expense"), revenueAccountId: await account("revenue") },
  };
}

async function createItem(s: Session, body: Record<string, unknown>) {
  const res = await call(s.token, "POST", "/items", { companyId: s.companyId, type: "inventory", ...s.accounts, ...body });
  expect(res.status, res.text).toBe(201);
  return res.body as { id: string; code: string };
}

describe("public online store: one company per store, published items only, no cost data", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await open("a");
    b = await open("b");
  }, 120_000);

  afterAll(() => server?.close());

  it("a store cannot be enabled without a link, and a link is unique across tenants", async () => {
    const noSlug = await call(a.token, "PATCH", `/companies/${a.companyId}`, { storeEnabled: true });
    expect(noSlug.status, noSlug.text).toBe(400);

    const enabledA = await call(a.token, "PATCH", `/companies/${a.companyId}`, { storeEnabled: true, storeSlug: a.slug.toUpperCase(), storeName: "متجر أ", storeWhatsappNumber: "+966 50 000 0001" });
    expect(enabledA.status, enabledA.text).toBe(200);
    // الرابط يُحفَظ بحروف صغيرة والرقم أرقاماً فقط
    expect(enabledA.body.storeSlug).toBe(a.slug);
    expect(enabledA.body.storeWhatsappNumber).toBe("966500000001");

    const stolen = await call(b.token, "PATCH", `/companies/${b.companyId}`, { storeEnabled: true, storeSlug: a.slug });
    expect(stolen.status, stolen.text).toBe(409);

    const enabledB = await call(b.token, "PATCH", `/companies/${b.companyId}`, { storeEnabled: true, storeSlug: b.slug });
    expect(enabledB.status, enabledB.text).toBe(200);
  });

  it("lists only published, priced, non-archived items of the store's own company — VAT-inclusive, without cost fields", async () => {
    const shown = await createItem(a, { code: `LOCK-${stamp}`, name: "ترباس أسود", nameEn: "Black bolt", category: "ترابيس", salePrice: 35, priceIncludesVat: false, publishedInStore: true, storeDescription: "ترباس ألمنيوم", countryOfOrigin: "الهند" });
    await createItem(a, { code: `HIDDEN-${stamp}`, name: "صنف غير منشور", category: "ترابيس", salePrice: 10 });
    await createItem(a, { code: `NOPRICE-${stamp}`, name: "صنف بلا سعر", category: "ترابيس", publishedInStore: true });
    const archived = await createItem(a, { code: `ARCH-${stamp}`, name: "صنف مؤرشف", category: "ترابيس", salePrice: 10, publishedInStore: true });
    expect((await call(a.token, "PATCH", `/items/${archived.id}`, { isArchived: true })).status).toBe(200);
    await createItem(b, { code: `OTHER-${stamp}`, name: "صنف الشركة الأخرى", category: "مقابض", salePrice: 50, publishedInStore: true });

    const list = await pub(`/store/${a.slug}/products`);
    expect(list.status, list.text).toBe(200);
    expect(list.body.products.map((p: { code: string }) => p.code)).toEqual([shown.code]);
    expect(list.body.total).toBe(1);

    const product = list.body.products[0];
    expect(product).toMatchObject({ code: shown.code, name: "ترباس أسود", nameEn: "Black bolt", category: "ترابيس", description: "ترباس ألمنيوم", countryOfOrigin: "الهند", price: 40.25, priceExVat: 35, vat: 5.25, inStock: false });
    // لا حقل تكلفة ولا كمية ولا معرّف داخلي ولا حساب — لا في القائمة ولا في أي مكان من الرد
    for (const secret of ["averageCost", "costPrice", "lastPurchasePrice", "stockValue", "quantity", "stockAccountId", "cogsAccountId", "tenantId", "companyId", shown.id]) {
      expect(list.text, secret).not.toContain(secret);
    }

    const info = await pub(`/store/${a.slug}`);
    expect(info.status, info.text).toBe(200);
    expect(info.body).toMatchObject({ slug: a.slug, name: "متجر أ", whatsappNumber: "966500000001", categories: [{ name: "ترابيس", count: 1 }] });

    // البحث والتصنيف لا يوسّعان النطاق
    expect((await pub(`/store/${a.slug}/products?search=${encodeURIComponent("صنف")}`)).body.total).toBe(0);
    expect((await pub(`/store/${a.slug}/products?category=${encodeURIComponent("مقابض")}`)).body.total).toBe(0);
    expect((await pub(`/store/${a.slug}/products?search=bolt`)).body.total).toBe(1);
  });

  it("does not serve another company's item, an unpublished item, or a disabled store", async () => {
    expect((await pub(`/store/${a.slug}/products/OTHER-${stamp}`)).status).toBe(404);
    expect((await pub(`/store/${a.slug}/products/HIDDEN-${stamp}`)).status).toBe(404);
    expect((await pub(`/store/${a.slug}/products/ARCH-${stamp}`)).status).toBe(404);
    expect((await pub(`/store/${b.slug}/products/LOCK-${stamp}`)).status).toBe(404);
    expect((await pub(`/store/${b.slug}/products/OTHER-${stamp}`)).status).toBe(200);
    expect((await pub(`/store/no-such-store-${stamp}/products`)).status).toBe(404);

    expect((await call(b.token, "PATCH", `/companies/${b.companyId}`, { storeEnabled: false })).status).toBe(200);
    expect((await pub(`/store/${b.slug}`)).status).toBe(404);
    expect((await pub(`/store/${b.slug}/products/OTHER-${stamp}`)).status).toBe(404);
  });

  it("shows availability from real stock movements, never the quantity", async () => {
    const item = await prisma.item.findFirstOrThrow({ where: { companyId: a.companyId, code: `LOCK-${stamp}` } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { companyId: a.companyId, isDefault: true } })).id;
    const moved = await call(a.token, "POST", "/stock-movements/in-out", { type: "in", itemId: item.id, warehouseId, quantity: 7, unitCost: 12.34, date: "2026-10-01" });
    expect(moved.status, moved.text).toBe(201);

    const product = await pub(`/store/${a.slug}/products/LOCK-${stamp}`);
    expect(product.status, product.text).toBe(200);
    expect(product.body.inStock).toBe(true);
    expect(product.text).not.toContain("12.34");
    expect(product.body).not.toHaveProperty("quantity");
  });

  it("serves a product image only as a store image of a published item of the same store", async () => {
    const item = await prisma.item.findFirstOrThrow({ where: { companyId: a.companyId, code: `LOCK-${stamp}` } });
    const hidden = await prisma.item.findFirstOrThrow({ where: { companyId: a.companyId, code: `HIDDEN-${stamp}` } });
    // سجلّ المرفق فقط (الرفع الفعلي يحتاج R2): المسار العام يفحص الملكية والنشر قبل توليد أي رابط
    const row = (entityType: string, entityId: string, mimeType = "image/png") =>
      prisma.attachment.create({ data: { tenantId: a.tenantId, entityType, entityId, fileName: "x.png", fileKey: `${a.tenantId}/x/${entityId}/x.png`, fileSize: 1, mimeType } });
    const ofHidden = await row("item_store_image", hidden.id);
    const notStoreImage = await row("sales_invoice", item.id);
    const notImage = await row("item_store_image", item.id, "application/pdf");
    const ok = await row("item_store_image", item.id);

    expect((await pub(`/store/${a.slug}/images/${ofHidden.id}`)).status).toBe(404);
    expect((await pub(`/store/${a.slug}/images/${notStoreImage.id}`)).status).toBe(404);
    expect((await pub(`/store/${a.slug}/images/${notImage.id}`)).status).toBe(404);
    // صورة سليمة لكن من رابط متجر آخر
    expect((await call(b.token, "PATCH", `/companies/${b.companyId}`, { storeEnabled: true })).status).toBe(200);
    expect((await pub(`/store/${b.slug}/images/${ok.id}`)).status).toBe(404);

    const product = await pub(`/store/${a.slug}/products/LOCK-${stamp}`);
    expect(product.body.images).toEqual([`/store/${a.slug}/images/${ok.id}`]);
  });
});
