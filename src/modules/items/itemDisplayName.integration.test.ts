import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * أسماء الأصناف بالإنجليزية في الواجهة الإنجليزية (getItemDisplayName، frontend/src/wired/shared/itemDisplayName.js) — اختبار لكل نوع
 * شاشة على مُخرَجات النظام نفسها (القاعدة 2): الأصناف من POST /api/items، والصفوف من نقاط النهاية التي تقرؤها الشاشات فعلاً (قائمة
 * الأصناف، تقرير الأرصدة، كرت الصنف، حركات المخزون، مرشّحات الجرد الدوري). صنف له nameEn يُعرض به في الإنجليزية، وصنف بلا nameEn يعود
 * لاسمه العربي، والعربية كما هي. الكود الأمامي يُستورد من الواجهة نفسها (كما في legacyRejectedReissue.integration.test.ts).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const front = (rel: string) => import(path.resolve("frontend", rel) as string);
const stamp = Date.now();
let server: Server;
let baseUrl = "";
let token = "";
let companyId = "";
type Item = { id: string; code: string; name: string; nameEn: string | null; unit: string | null };
let withEn: Item;
let arabicOnly: Item;
let periodic: Item;

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

describe("item names follow the UI language on every screen type (English UI → nameEn, else the Arabic name)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `أسماء الأصناف ${stamp}`, businessActivity: "retail", name: "المالك", email: `item-names-${stamp}@example.com`, password: "Str0ng-Pass!" });
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
    const account = async (type: "asset" | "expense" | "revenue") =>
      (await prisma.account.findFirstOrThrow({ where: { companyId, type, isPosting: true } })).id;
    const [stockAccountId, cogsAccountId, revenueAccountId] = [await account("asset"), await account("expense"), await account("revenue")];
    const create = async (body: Record<string, unknown>) => {
      const res = await call("POST", "/items", { companyId, stockAccountId, cogsAccountId, revenueAccountId, ...body });
      expect(res.status, res.text).toBe(201);
      return res.body as Item;
    };
    withEn = await create({ code: `CEM-${stamp}`, name: "إسمنت", nameEn: "Cement", type: "inventory", unit: "كجم", salePrice: 20 });
    arabicOnly = await create({ code: `TIL-${stamp}`, name: "بلاط", nameEn: "  ", type: "inventory", unit: "علبة مخصصة", salePrice: 30 });
    periodic = await create({ code: `PER-${stamp}`, name: "رمل", nameEn: "Sand", type: "periodic_inventory", unit: "طن", purchasesAccountId: cogsAccountId });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { companyId, isDefault: true } })).id;
    // صنف الجرد الدوري لا يقبل حركة إدخال/إخراج يدوية، ويظهر في مرشّحات التسوية بلا حركة
    for (const item of [withEn, arabicOnly]) {
      const moved = await call("POST", "/stock-movements/in-out", { type: "in", itemId: item.id, warehouseId, quantity: 5, unitCost: 10, date: "2026-10-01" });
      expect(moved.status, moved.text).toBe(201);
    }
  }, 120_000);

  afterAll(() => server?.close());

  it("items list and item view: primary name and the secondary line swap with the language", async () => {
    const React = (await front("node_modules/react/index.js")).default;
    const { renderToStaticMarkup } = await front("node_modules/react-dom/server.node.js");
    const ItemName = (await front("src/wired/shared/ItemName.jsx")).default;
    const listed = (await call("GET", `/items?companyId=${companyId}`)).body as Item[];
    const byId = (id: string) => listed.find((i) => i.id === id)!;
    const html = (item: Item, language: string) => renderToStaticMarkup(React.createElement(ItemName, { item, language }));
    expect(html(byId(withEn.id), "en")).toBe('<strong>Cement</strong><small dir="rtl">إسمنت</small>');
    expect(html(byId(withEn.id), "ar")).toBe('<strong>إسمنت</strong><small dir="ltr">Cement</small>');
    // nameEn فارغ (مسافات): الاسم العربي وحده، بلا سطر ثانوي مكرَّر
    expect(html(byId(arabicOnly.id), "en")).toBe("<strong>بلاط</strong>");
    expect(html(byId(arabicOnly.id), "ar")).toBe("<strong>بلاط</strong>");
  });

  it("item pickers (sales/purchase lines, returns, stock in/out, issue, transfer, POS tiles): label by language, search by either name", async () => {
    const { getItemDisplayName, itemOptionLabel } = await front("src/wired/shared/itemDisplayName.js");
    const { itemMatches, itemDescription } = await front("src/wired/shared/itemDefaults.js");
    const listed = (await call("GET", `/items?companyId=${companyId}`)).body as Item[];
    const cement = listed.find((i) => i.id === withEn.id)!;
    const tile = listed.find((i) => i.id === arabicOnly.id)!;
    expect([getItemDisplayName(cement, "en"), getItemDisplayName(cement, "ar")]).toEqual(["Cement", "إسمنت"]);
    expect(getItemDisplayName(tile, "en")).toBe("بلاط");
    expect(itemOptionLabel(cement, "en")).toBe(`Cement (CEM-${stamp})`);
    expect(listed.filter((i) => itemMatches(i, "cement")).map((i) => i.id)).toEqual([withEn.id]);
    expect(listed.filter((i) => itemMatches(i, "إسمنت")).map((i) => i.id)).toEqual([withEn.id]);
    // السطر المضاف إلى المستند لا يتبع لغة الواجهة: يبقى الوصف المخزَّن نفسه كما اليوم
    expect(itemDescription(cement)).toBe("إسمنت / Cement");
  });

  it("stock balance report: rows carry itemNameEn; English shows it, falls back to the Arabic name, units through the dictionary", async () => {
    const { getItemDisplayName, getUnitDisplayLabel } = await front("src/wired/shared/itemDisplayName.js");
    const rows = (await call("GET", `/inventory-reports/stock-report?companyId=${companyId}`)).body as { itemId: string; itemName: string; itemNameEn: string | null; unit: string }[];
    const row = (id: string) => rows.find((r) => r.itemId === id)!;
    expect(row(withEn.id)).toMatchObject({ itemName: "إسمنت", itemNameEn: "Cement" });
    expect([getItemDisplayName(row(withEn.id), "en"), getItemDisplayName(row(withEn.id), "ar")]).toEqual(["Cement", "إسمنت"]);
    expect(getItemDisplayName(row(arabicOnly.id), "en")).toBe("بلاط");
    expect([getUnitDisplayLabel(row(withEn.id).unit, "en"), getUnitDisplayLabel(row(withEn.id).unit, "ar")]).toEqual(["kg", "كجم"]);
    expect(getUnitDisplayLabel(row(arabicOnly.id).unit, "en")).toBe("علبة مخصصة"); // وحدة غير معروفة كما كُتبت
  });

  it("item card and stock movements: the item object from the API shows nameEn in English", async () => {
    const { getItemDisplayName } = await front("src/wired/shared/itemDisplayName.js");
    const card = (await call("GET", `/stock-movements/item-card/${withEn.id}?companyId=${companyId}`)).body;
    expect(getItemDisplayName(card.item, "en")).toBe("Cement");
    const movements = (await call("GET", `/stock-movements?companyId=${companyId}`)).body as { item: Item }[];
    const names = movements.map((m) => getItemDisplayName(m.item, "en"));
    expect(names).toEqual(expect.arrayContaining(["Cement", "بلاط"]));
  });

  it("periodic settlement candidates carry nameEn; English shows it", async () => {
    const { getItemDisplayName, getUnitDisplayLabel } = await front("src/wired/shared/itemDisplayName.js");
    const candidates = (await call("GET", `/periodic-settlement/candidates?companyId=${companyId}`)).body as Item[];
    const sand = candidates.find((c) => c.id === periodic.id)!;
    expect([getItemDisplayName(sand, "en"), getItemDisplayName(sand, "ar"), getUnitDisplayLabel(sand.unit, "en")]).toEqual(["Sand", "رمل", "ton"]);
  });
});
