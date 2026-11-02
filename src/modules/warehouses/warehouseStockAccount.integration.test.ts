import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createPurchaseInvoice } from "../purchaseInvoices/purchaseInvoices.service";

/**
 * حساب مخزون لكل مستودع — على Postgres حقيقي وعبر مسارات HTTP الفعلية (/warehouses و/stock-movements) وخدمة فاتورة
 * الشراء الحقيقية. القيود التي تُفحَص يُنتجها الكود نفسه (CLAUDE.md القاعدة 2)؛ لا شيء مصنوع يدوياً سوى إعداد المستأجر.
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بمبالغ مختلفة: ربط مستودع بحساب الشركة الأخرى يُرفَض، والأرقام لا تختلط.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `حساب المستودع ${stamp}`;
let server: Server;
let baseUrl = "";

interface Ctx {
  email: string;
  token: string;
  userId: string;
  tenantId: string;
  companyId: string;
  defaultWarehouseId: string;
  itemId: string;
  itemStockAccountId: string;
  /** حساب أصول ترحيل آخر من نفس الشركة يُستخدَم حساباً للمستودع الجديد */
  warehouseAccountId: string;
  expenseAccountId: string;
}
const ctx: Record<"a" | "b", Ctx> = {} as never;

async function call(method: string, path: string, token: string, body?: unknown, lang = "ar") {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "accept-language": lang },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `wh-acc-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `حساب مستودع ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const item = await prisma.item.findFirstOrThrow({ where: { tenantId, companyId: company.id, code: "0003" } });
  const defaultWarehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenantId, companyId: company.id, isDefault: true } });
  // حساب مخزون آخر من الشجرة الابتدائية (114001 بينما صنف الديزل على 114002) — حساب لا يمسّه أي قيد آخر في الاختبار
  const otherAsset = await prisma.account.findFirstOrThrow({
    where: { tenantId, companyId: company.id, code: "114001", type: "asset", isPosting: true, isArchived: false },
  });
  expect(otherAsset.id).not.toBe(item.stockAccountId);
  const expense = await prisma.account.findFirstOrThrow({ where: { tenantId, companyId: company.id, type: "expense", isPosting: true, isArchived: false } });
  return {
    email, token: r.accessToken, userId: r.user.id, tenantId, companyId: company.id, defaultWarehouseId: defaultWarehouse.id,
    itemId: item.id, itemStockAccountId: item.stockAccountId!, warehouseAccountId: otherAsset.id, expenseAccountId: expense.id,
  };
}

const linesOf = async (entryId: string) =>
  (await prisma.journalEntryLine.findMany({ where: { journalEntryId: entryId } })).map((l) => `${l.accountId}|${Number(l.debit).toFixed(2)}|${Number(l.credit).toFixed(2)}`).sort();

describe("inventory account per warehouse (integration)", () => {
  const wh: Record<"a" | "b", string> = { a: "", b: "" };

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a");
    ctx.b = await setupTenant("b");
  }, 180_000);

  afterAll(async () => {
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.stockMovement.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.purchaseInvoice.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.journalEntry.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.warehouse.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("only accepts an active posting asset account of the same company", async () => {
    const a = ctx.a;
    const foreign = await call("POST", "/warehouses", a.token, { companyId: a.companyId, name: "مستودع غريب", stockAccountId: ctx.b.warehouseAccountId }, "en");
    expect(foreign.status, foreign.text).toBe(400);
    expect(foreign.body.error).toBe("The warehouse inventory account must be an active, non-archived posting asset account of the same company");
    const notAsset = await call("POST", "/warehouses", a.token, { companyId: a.companyId, name: "مستودع مصروف", stockAccountId: a.expenseAccountId });
    expect(notAsset.status, notAsset.text).toBe(400);

    for (const key of ["a", "b"] as const) {
      const c = ctx[key];
      const created = await call("POST", "/warehouses", c.token, { companyId: c.companyId, name: "مستودع المحطة", stockAccountId: c.warehouseAccountId });
      expect(created.status, created.text).toBe(201);
      expect(created.body.stockAccountId).toBe(c.warehouseAccountId);
      wh[key] = created.body.id;
    }
  });

  it("posts purchases, stock-in and issues on the warehouse's account, and keeps legacy warehouses on the item's account", async () => {
    for (const [key, qty, price] of [["a", 100, 2], ["b", 30, 3]] as const) {
      const c = ctx[key];
      const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: c.companyId } });
      await createPurchaseInvoice(c.tenantId, c.userId, {
        companyId: c.companyId, supplierId: supplier.id, date: new Date("2026-10-01"),
        lines: [{ accountId: "derived-from-item", itemId: c.itemId, warehouseId: wh[key], quantity: qty, unitPrice: price }],
      } as never);
      const purchaseMove = await prisma.stockMovement.findFirstOrThrow({ where: { tenantId: c.tenantId, warehouseId: wh[key], type: "in" } });
      expect(purchaseMove.journalEntryId).toBeTruthy();
      const purchaseLines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: purchaseMove.journalEntryId! } });
      const stockDebit = purchaseLines.find((l) => Number(l.debit) > 0 && [c.warehouseAccountId, c.itemStockAccountId].includes(l.accountId));
      expect(stockDebit?.accountId).toBe(c.warehouseAccountId);
      expect(Number(stockDebit?.debit)).toBe(qty * price);
    }

    const a = ctx.a;
    const issue = await call("POST", "/stock-movements/issue", a.token, { itemId: a.itemId, warehouseId: wh.a, department: "المالية والحسابات", quantity: 10, date: "2026-10-02" });
    expect(issue.status, issue.text).toBe(201);
    const issueLines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: issue.body.journalEntryId } });
    expect(issueLines.find((l) => Number(l.credit) > 0)?.accountId).toBe(a.warehouseAccountId);

    // المستودع الافتراضي القديم (بلا حساب) يبقى على حساب الصنف
    const legacyIn = await call("POST", "/stock-movements/in-out", a.token, { type: "in", itemId: a.itemId, warehouseId: a.defaultWarehouseId, quantity: 5, unitCost: 2, date: "2026-10-02" });
    expect(legacyIn.status, legacyIn.text).toBe(201);
    expect(await linesOf(legacyIn.body.journalEntryId)).toContain(`${a.itemStockAccountId}|10.00|0.00`);
  });

  it("moves value between the two accounts on an internal transfer between warehouses with different accounts", async () => {
    const a = ctx.a;
    const transfer = await call("POST", "/stock-movements/transfer", a.token, {
      itemId: a.itemId, fromWarehouseId: wh.a, toWarehouseId: a.defaultWarehouseId, toCompanyId: a.companyId, quantity: 20, date: "2026-10-03",
    });
    expect(transfer.status, transfer.text).toBe(201);
    const unitCost = Number(transfer.body.outMovement.unitCost);
    const amount = (20 * unitCost).toFixed(2);
    expect(await linesOf(transfer.body.outMovement.journalEntryId)).toEqual([`${a.itemStockAccountId}|${amount}|0.00`, `${a.warehouseAccountId}|0.00|${amount}`].sort());
  });

  it("refuses to change the account of a warehouse that has movements, but allows it before any", async () => {
    const a = ctx.a;
    const locked = await call("PATCH", `/warehouses/${wh.a}`, a.token, { stockAccountId: a.itemStockAccountId });
    expect(locked.status, locked.text).toBe(400);
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: wh.a } })).stockAccountId).toBe(a.warehouseAccountId);

    const fresh = await call("POST", "/warehouses", a.token, { companyId: a.companyId, name: "مستودع فارغ", stockAccountId: a.warehouseAccountId });
    expect(fresh.status, fresh.text).toBe(201);
    const changed = await call("PATCH", `/warehouses/${fresh.body.id}`, a.token, { stockAccountId: a.itemStockAccountId });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.stockAccountId).toBe(a.itemStockAccountId);
    // تعديل حقل آخر بلا تغيير الحساب مسموح دائماً
    expect((await call("PATCH", `/warehouses/${wh.a}`, a.token, { location: "جدة" })).status).toBe(200);
  });

  it("keeps the other tenant's same-named company on its own numbers", async () => {
    const b = ctx.b;
    const bLines = await prisma.journalEntryLine.findMany({ where: { journalEntry: { tenantId: b.tenantId }, accountId: b.warehouseAccountId } });
    expect(bLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBe(90);
    expect(await prisma.journalEntryLine.count({ where: { journalEntry: { tenantId: b.tenantId }, accountId: ctx.a.warehouseAccountId } })).toBe(0);
  });
});
