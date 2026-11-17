import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * خيارات المنتج في المتجر (لون/مقاس): أصناف مستقلة تحمل رمز مجموعة واحداً تُعرَض منتجاً واحداً.
 * عبر HTTP على مُخرَجات النظام (القاعدة 2): الأصناف والمخزون من مسارات أثر، والقائمة والمنتج والخلاصة من المتجر العام.
 * المصنوع يدوياً صف مرفق الصورة فقط (الملف في تخزين خارجي R2).
 * مستأجران يستخدمان رمز المجموعة نفسه (القاعدة 4): مجموعة شركة لا تضمّ أصناف شركة أخرى ولا صورها.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
type Session = { token: string; tenantId: string; companyId: string; slug: string };
let a: Session;
let b: Session;
const GROUP = "TM-01";
const code = (x: string) => `${x}-${stamp}`;
const ids: Record<string, string> = {};

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
  const r = await register({ tenantName: `خيارات المتجر ${label} ${stamp}`, businessActivity: "retail", name: "المالك", email: `store-var-${label}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const slug = `var-${label}-${stamp}`;
  const enabled = await call(r.accessToken, "PATCH", `/companies/${companyId}`, { storeEnabled: true, storeSlug: slug });
  expect(enabled.status, enabled.text).toBe(200);
  return { token: r.accessToken, tenantId: r.tenant.id, companyId, slug };
}

async function createItem(s: Session, body: Record<string, unknown>, stock = 5) {
  const account = async (type: "asset" | "expense" | "revenue") => (await prisma.account.findFirstOrThrow({ where: { companyId: s.companyId, type, isPosting: true } })).id;
  const res = await call(s.token, "POST", "/items", {
    companyId: s.companyId, type: "inventory", publishedInStore: true, priceIncludesVat: false, category: "مقابض سحب",
    stockAccountId: await account("asset"), cogsAccountId: await account("expense"), revenueAccountId: await account("revenue"), ...body,
  });
  expect(res.status, res.text).toBe(201);
  if (stock > 0) {
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { companyId: s.companyId, isDefault: true } })).id;
    const moved = await call(s.token, "POST", "/stock-movements/in-out", { type: "in", itemId: res.body.id, warehouseId, quantity: stock, unitCost: 10, date: "2026-10-01" });
    expect(moved.status, moved.text).toBe(201);
  }
  return res.body.id as string;
}

describe("store product variants (color / size)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await open("a");
    b = await open("b");
    const variant = { storeVariantGroup: GROUP, storeVariantSize: "450mm" };
    ids.black = await createItem(a, { ...variant, code: code("TM01-MB"), name: "مقبض سحب TM-01 أسود", salePrice: 100, storeVariantColor: "Matt Black" });
    ids.gold = await createItem(a, { ...variant, code: code("TM01-GM"), name: "مقبض سحب TM-01 ذهبي", salePrice: 120, storeVariantColor: "Gold Matt" }, 0);
    ids.satin = await createItem(a, { ...variant, code: code("TM01-SM"), name: "مقبض سحب TM-01 ساتان", salePrice: 100, storeVariantColor: "Satin Matt", storeVariantSize: "300mm" });
    ids.hidden = await createItem(a, { ...variant, code: code("TM01-BA"), name: "مقبض سحب TM-01 نحاسي", salePrice: 100, storeVariantColor: "Brass Antique", publishedInStore: false });
    ids.single = await createItem(a, { code: code("LOCK"), name: "قفل ذكي", salePrice: 150, storeVariantGroup: "  " });
    ids.other = await createItem(b, { ...variant, code: code("TM01-MB"), name: "مقبض الشركة الأخرى", salePrice: 999, storeVariantColor: "Other Tenant" });
  }, 120_000);

  afterAll(() => server?.close());

  it("lists a variant group as one product card and counts it once in its category", async () => {
    const list = await call(null, "GET", `/store/${a.slug}/products?sort=name`);
    expect(list.status, list.text).toBe(200);
    expect(list.body.total).toBe(2);
    const group = list.body.products.filter((p: any) => p.variantGroup === GROUP);
    expect(group).toHaveLength(1);
    expect(group[0].variantCount).toBe(3);
    expect(list.body.products.find((p: any) => p.code === code("LOCK"))).toMatchObject({ variantGroup: null, variantCount: 1 });
    const info = await call(null, "GET", `/store/${a.slug}`);
    expect(info.body.categories).toEqual([{ name: "مقابض سحب", count: 2 }]);
    // أول صنف بحسب الترتيب يمثّل المجموعة (هنا الأغلى)، والبحث يجمّع ما طابق فقط
    const cheap = await call(null, "GET", `/store/${a.slug}/products?sort=price_desc`);
    expect(cheap.body.products.find((p: any) => p.variantGroup === GROUP).code).toBe(code("TM01-GM"));
    const search = await call(null, "GET", `/store/${a.slug}/products?search=${encodeURIComponent("ذهبي")}`);
    expect(search.body).toMatchObject({ total: 1, products: [{ code: code("TM01-GM"), variantCount: 1 }] });
  });

  it("returns the published variants of the same store's group with each one's own price and stock", async () => {
    const res = await call(null, "GET", `/store/${a.slug}/products/${code("TM01-MB")}`);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ variantGroup: GROUP, color: "Matt Black", size: "450mm", price: 115 });
    expect(res.body.variants).toEqual([
      { code: code("TM01-GM"), color: "Gold Matt", size: "450mm", price: 138, compareAtPrice: null, inStock: false, image: null },
      { code: code("TM01-MB"), color: "Matt Black", size: "450mm", price: 115, compareAtPrice: null, inStock: true, image: null },
      { code: code("TM01-SM"), color: "Satin Matt", size: "300mm", price: 115, compareAtPrice: null, inStock: true, image: null },
    ]);
    // منتج بلا مجموعة (أو برمز فراغات) بلا خيارات، والمتجر الآخر يرى مجموعته هو فقط
    expect((await call(null, "GET", `/store/${a.slug}/products/${code("LOCK")}`)).body).toMatchObject({ variantGroup: null, variants: [] });
    expect((await call(null, "GET", `/store/${b.slug}/products/${code("TM01-MB")}`)).body).toMatchObject({ color: "Other Tenant", price: 1148.85, variants: [] });
  });

  it("shows a variant without its own photos with its group's photos, never another store's", async () => {
    const mine = await prisma.attachment.create({ data: { tenantId: a.tenantId, entityType: "item_store_image", entityId: ids.satin, fileName: "a.png", fileKey: `${a.tenantId}/x/${ids.satin}/a.png`, fileSize: 1, mimeType: "image/png" } });
    const theirs = await prisma.attachment.create({ data: { tenantId: b.tenantId, entityType: "item_store_image", entityId: ids.other, fileName: "b.png", fileKey: `${b.tenantId}/x/${ids.other}/b.png`, fileSize: 1, mimeType: "image/png" } });
    const path = `/store/${a.slug}/images/${mine.id}`;
    const black = await call(null, "GET", `/store/${a.slug}/products/${code("TM01-MB")}`);
    expect(black.body.images).toEqual([path]);
    expect(black.body.variants.map((v: any) => v.image)).toEqual([path, path, path]);
    expect(black.text).not.toContain(theirs.id);
    const list = await call(null, "GET", `/store/${a.slug}/products?sort=price_desc`);
    expect(list.body.products.find((p: any) => p.variantGroup === GROUP).images).toEqual([path]);
    // المنتج المستقل لا يستعير صوراً
    expect((await call(null, "GET", `/store/${a.slug}/products/${code("LOCK")}`)).body.images).toEqual([]);

    const feed = (await call(null, "GET", `/store/${a.slug}/feed.csv`)).text.trim().split("\r\n");
    expect(feed[0].endsWith("brand,item_group_id,color,size")).toBe(true);
    expect(feed).toHaveLength(4);
    expect(feed.find((l) => l.startsWith(`"${code("TM01-GM")}"`))).toContain(`"${GROUP}","Gold Matt","450mm"`);
    expect(feed.join("\n")).not.toContain("Other Tenant");
  });
});
