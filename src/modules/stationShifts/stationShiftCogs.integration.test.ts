import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { hashPassword } from "../../lib/password";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createPurchaseInvoice } from "../purchaseInvoices/purchaseInvoices.service";
import * as shifts from "./stationShifts.service";
import { STATION_WAREHOUSE_MISSING } from "./stationShiftCogs";
import { STATION_SHIFT_ENTRY_LOCKED } from "../journalEntries/journalEntries.service";

/**
 * تكلفة الوقود في ورديات المحطات، وعكس الوردية، والوردية المصحَّحة، وحماية قيد الوردية — على Postgres حقيقي وعبر مسارات
 * HTTP الفعلية. القيود والمعاينات وحركات المخزون التي تُفحَص يُنتجها الكود نفسه (approve/post/reverse/corrected-shift،
 * فاتورة شراء حقيقية لمتوسط التكلفة) — CLAUDE.md القاعدة 2؛ ما يُصنَع يدوياً هو ما يصل من خارج النظام فقط: صفّ الوردية
 * المفتوحة بتاريخ مختار (فتح العامل يأخذ تاريخ اليوم دائماً) وصفّ صورة العداد (رفع ملف).
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بمبالغ مختلفة، ليظهر أي دمج بين الشركات في الأرقام.
 *
 * خط زمني لمحطة المستأجر A (تُنشأ الورديات بترتيب تواريخها لأن قراءة الافتتاح تُشتَق من آخر وردية سابقة):
 *   X  2026-10-05  ديزل 10            ← فحوص الاعتماد المسبقة، المعاينة، ترحيل
 *   A1 2026-10-06  ديزل 200 + 91 30   ← ترحيل بالتكلفة، ثم عكس، ثم وردية مصحَّحة بدلها
 *   Y  2026-10-07  بنزين 95 5         ← يُرفض اعتمادها (متوسط صفر) فتُرفض، ثم وردية مصحَّحة Y' بدلها تُرحَّل بعد شراء 95
 *                                      (اللترات الخمسة صُرفت فعلاً: Z تفتتح بعدها) — Y' هي "الوردية اللاحقة" القائمة لـA1
 *   Z  2026-10-08  ديزل 20            ← الترحيل يعيد فحوصه (فكّ المستودع بعد الاعتماد)
 * المخزون: ديزل 5000 بـ1.50، 91 ألف بـ2.00، 95 بلا شراء. المستأجر B: ديزل 50 بـ1.70 (الرصيد السالب).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `محطات مشتركة ${stamp}`;
const PIN = "4826";
let server: Server;
let baseUrl = "";

type Product = "diesel" | "gasoline_91" | "gasoline_95";
interface Ctx {
  email: string;
  token: string;
  userId: string;
  tenantId: string;
  companyId: string;
  station: string;
  employeeId: string;
  warehouseId: string;
  items: Record<Product, string>;
  acc: { stock114001: string; stock114002: string; cogs: string; cash: string; shortage: string };
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

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `cogs-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `تكلفة الوقود ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "المحطة 1" } })).id;
  const token = r.accessToken;

  for (const pumpType of ["diesel", "petrol"] as const) {
    const pump = await call("POST", "/station-setup/pumps", token, {
      companyId: company.id, costCenterId: station, pumpType, meterType: "electronic", hasMoneyMeter: false,
      nozzles: [{ meterDigits: 7, initialReading: 1000 }, { meterDigits: 7, initialReading: 2000 }],
    });
    expect(pump.status, pump.text).toBe(201);
  }
  for (const [product, price] of [["diesel", 2.3], ["gasoline_91", 2.18], ["gasoline_95", 2.33]] as const) {
    const res = await call("POST", "/station-setup/fuel-prices", token, { companyId: company.id, product, priceInclVat: price, effectiveFrom: "2026-01-01" });
    expect(res.status, res.text).toBe(201);
  }
  const employeeId = (await prisma.stationUser.create({
    data: { tenantId, companyId: company.id, name: "عامل المحطة", role: "worker", costCenterId: station, active: true },
  })).id;
  // البيانات الابتدائية لنشاط المحطات: أصناف 0001/0002/0003 ومستودع افتراضي وحسابا العجز/الزيادة (src/lib/starterData.ts)
  const itemByCode = async (code: string) => (await prisma.item.findFirstOrThrow({ where: { tenantId, companyId: company.id, code } })).id;
  const accByCode = async (code: string) => (await prisma.account.findFirstOrThrow({ where: { tenantId, companyId: company.id, code } })).id;
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { tenantId, companyId: company.id, isDefault: true } })).id;
  const shortage = (await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).stationCashShortageAccountId!;
  return {
    email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, warehouseId,
    items: { gasoline_91: await itemByCode("0001"), gasoline_95: await itemByCode("0002"), diesel: await itemByCode("0003") },
    acc: { stock114001: await accByCode("114001"), stock114002: await accByCode("114002"), cogs: await accByCode("511001"), cash: await accByCode("111001").catch(() => ""), shortage },
  };
}

async function buy(c: Ctx, itemId: string, quantity: number, unitPrice: number) {
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: c.companyId } });
  await createPurchaseInvoice(c.tenantId, c.userId, {
    companyId: c.companyId, supplierId: supplier.id, date: day("2026-10-01"),
    lines: [{ accountId: "derived-from-item", itemId, warehouseId: c.warehouseId, quantity, unitPrice }],
  } as never);
}

/** وردية حتى "قيد المراجعة" بقيم المحاسب عبر مسارات الخدمة الحقيقية: قراءات، صور، تحصيل، إرسال، تصحيح المحاسب. */
async function reviewedShift(c: Ctx, date: string, litersByProduct: Partial<Record<Product, number>>) {
  const shift = await prisma.stationShift.create({
    data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.station, stationUserId: c.employeeId, shiftDate: day(date), shiftType: "morning", openedAt: new Date(), status: "open" },
  });
  const nozzles = await prisma.stationNozzle.findMany({ where: { tenantId: c.tenantId, costCenterId: c.station, isActive: true }, orderBy: [{ pumpNumber: "asc" }, { nozzleNumber: "asc" }] });
  const readings: { id: string; product: Product }[] = [];
  for (const n of nozzles) {
    const reading = await shifts.submitReading(c.tenantId, c.employeeId, shift.id, { nozzleId: n.id, capturedAt: new Date() });
    await prisma.attachment.create({ data: { tenantId: c.tenantId, entityType: "station_shift_reading", entityId: reading.id, fileName: "meter.jpg", fileKey: `k-${reading.id}`, fileSize: 1, mimeType: "image/jpeg" } });
    readings.push({ id: reading.id, product: n.product });
  }
  await shifts.updateCollections(c.tenantId, c.employeeId, shift.id, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 0 });
  await shifts.submitShift(c.tenantId, c.employeeId, shift.id);
  const remaining = { ...litersByProduct };
  for (const r of readings) {
    const row = await prisma.stationShiftReading.findUniqueOrThrow({ where: { id: r.id } });
    const liters = remaining[r.product] ?? 0; // كل لترات المنتج على أول فوهة له
    remaining[r.product] = 0;
    await shifts.correctReading(c.tenantId, c.userId, shift.id, r.id, Number(row.openingReading) + liters);
  }
  return shift.id;
}

const approve = (c: Ctx, shiftId: string, lang = "ar") => call("POST", `/station-shifts/${shiftId}/approve`, c.token, undefined, lang);
const post = (c: Ctx, shiftId: string, lang = "ar") => call("POST", `/station-shifts/${shiftId}/post`, c.token, undefined, lang);

async function approvedAndPosted(c: Ctx, shiftId: string) {
  const a = await approve(c, shiftId);
  expect(a.status, a.text).toBe(200);
  const p = await post(c, shiftId);
  expect(p.status, p.text).toBe(200);
  return p.body.journalEntryId as string;
}

const balance = async (c: Ctx, itemId: string, warehouseId = c.warehouseId) => {
  const rows = await prisma.stockMovement.findMany({ where: { tenantId: c.tenantId, companyId: c.companyId, itemId, warehouseId } });
  return rows.reduce((s, m) => {
    const q = Number(m.quantity);
    if (m.type === "in" || m.type === "transfer_in") return s + q;
    if (m.type === "out" || m.type === "issue" || m.type === "transfer_out") return s - q;
    return m.type === "adjustment" ? s + q : s;
  }, 0);
};

const entryLines = async (entryId: string) =>
  (await prisma.journalEntryLine.findMany({ where: { journalEntryId: entryId }, orderBy: { id: "asc" } })).map((l) => ({
    accountId: l.accountId, costCenterId: l.costCenterId, debit: Number(l.debit), credit: Number(l.credit),
  }));

const sortLines = (lines: { accountId: string; debit: number; credit: number }[]) =>
  lines.map((l) => `${l.accountId}|${Number(l.debit).toFixed(2)}|${Number(l.credit).toFixed(2)}`).sort();

const readingsOf = (shiftId: string) =>
  prisma.stationShiftReading.findMany({ where: { shiftId }, include: { nozzle: true }, orderBy: [{ nozzle: { pumpNumber: "asc" } }, { nozzle: { nozzleNumber: "asc" } }] });

describe("station shift cost of sales, reversal, corrected shifts and entry protection (integration)", () => {
  const ids: Record<string, string> = {};
  let otherCompanyA = "";

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a");
    ctx.b = await setupTenant("b");
    await buy(ctx.a, ctx.a.items.diesel, 5000, 1.5);
    await buy(ctx.a, ctx.a.items.gasoline_91, 1000, 2);
    await buy(ctx.b, ctx.b.items.diesel, 50, 1.7);

    // شركة ثانية داخل مستأجر A — لاختبار رفض ربط صنفها/مستودعها/حساباتها بشركة A
    const other = await call("POST", "/companies", ctx.a.token, { name: `شركة أخرى ${stamp}`, businessActivity: "fuel_stations" });
    expect(other.status, other.text).toBe(201);
    otherCompanyA = other.body.id;
  }, 180_000);

  afterAll(async () => {
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.stockMovement.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationShift.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("approval pre-checks the cost-of-sales prerequisites with the posting messages; the preview shows the reason, then the COGS lines", async () => {
    const c = ctx.a;
    ids.X = await reviewedShift(c, "2026-10-05", { diesel: 10 });

    const noMapping = await approve(c, ids.X);
    expect(noMapping.status, noMapping.text).toBe(400);
    expect(noMapping.body.error).toBe("لم يُربَط صنف مخزون بمنتج «ديزل» في بيانات الشركة — اربطه من إعدادات الشركة قبل ترحيل الوردية");
    const previewBefore = await call("GET", `/station-shifts/${ids.X}`, c.token);
    expect(previewBefore.status, previewBefore.text).toBe(200);
    expect(previewBefore.body.summary.cogsError).toBe(noMapping.body.error);
    expect(previewBefore.body.summary.cogsLines).toEqual([]);

    const map = await call("PATCH", `/companies/${c.companyId}`, c.token, {
      stationDieselItemId: c.items.diesel, stationGasoline91ItemId: c.items.gasoline_91, stationGasoline95ItemId: c.items.gasoline_95,
    });
    expect(map.status, map.text).toBe(200);

    const noWarehouse = await approve(c, ids.X, "en");
    expect(noWarehouse.status, noWarehouse.text).toBe(400);
    expect(noWarehouse.body.error).toBe("No warehouse is set for this station — link a warehouse to the station in station setup before posting the shift");
    expect(STATION_WAREHOUSE_MISSING).toContain("لم يُحدَّد مستودع");
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: ids.X } })).status).toBe("under_review");

    const link = await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: c.warehouseId });
    expect(link.status, link.text).toBe(200);

    // المعاينة: أسطر الإقفال + تكلفة الديزل 10 × 1.50 = 15.00 بمركز تكلفة المحطة
    const preview = (await call("GET", `/station-shifts/${ids.X}`, c.token)).body.summary;
    expect([preview.linesSource, preview.cogsError]).toEqual(["preview", null]);
    expect(preview.cogsLines).toEqual([
      expect.objectContaining({ accountId: c.acc.cogs, costCenterId: c.station, debit: 15, credit: 0 }),
      expect.objectContaining({ accountId: c.acc.stock114002, costCenterId: c.station, debit: 0, credit: 15 }),
    ]);
    expect(preview.lines).toEqual(expect.arrayContaining(preview.cogsLines));
    expect(preview.accounts.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([c.acc.cogs, c.acc.stock114002]));

    const entry = await approvedAndPosted(c, ids.X);
    // القيد المرحَّل = المعاينة تماماً، وبعد الترحيل تعرض الشاشة القيد الفعلي
    expect(sortLines(await entryLines(entry))).toEqual(sortLines(preview.lines));
    const afterPost = (await call("GET", `/station-shifts/${ids.X}`, c.token)).body.summary;
    expect(afterPost.linesSource).toBe("posted");
    expect(sortLines(afterPost.lines)).toEqual(sortLines(preview.lines));
    expect(await balance(c, c.items.diesel)).toBe(4990);
  });

  it("refuses to link another company's item, warehouse or cash account, even inside the same tenant", async () => {
    const c = ctx.a;
    const foreignItem = await prisma.item.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: otherCompanyA, code: "0003" } });
    const foreignWarehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: otherCompanyA } });
    const badItem = await call("PATCH", `/companies/${c.companyId}`, c.token, { stationDieselItemId: foreignItem.id });
    expect(badItem.status, badItem.text).toBe(400);
    expect(badItem.body.error).toBe("صنف الوقود المختار غير موجود ضمن هذه الشركة");
    expect((await call("PATCH", `/companies/${c.companyId}`, c.token, { stationDieselItemId: ctx.b.items.diesel })).status).toBe(400);

    const badWarehouse = await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: foreignWarehouse.id });
    expect(badWarehouse.status, badWarehouse.text).toBe(400);
    expect(badWarehouse.body.error).toBe("المستودع غير موجود ضمن هذه الشركة");
    expect((await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: ctx.b.warehouseId })).status).toBe(400);

    // حسابا العجز/الزيادة: من شركة أخرى بنفس المستأجر، أو من مستأجر آخر، أو حساب تجميعي غير ترحيلي — كلها مرفوضة
    const foreignShortage = (await prisma.company.findUniqueOrThrow({ where: { id: otherCompanyA } })).stationCashShortageAccountId!;
    const groupAccount = await prisma.account.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: c.companyId, isPosting: false } });
    for (const [field, accountId] of [
      ["stationCashShortageAccountId", foreignShortage],
      ["stationCashSurplusAccountId", (await prisma.company.findUniqueOrThrow({ where: { id: ctx.b.companyId } })).stationCashSurplusAccountId!],
      ["stationCashShortageAccountId", groupAccount.id],
    ] as const) {
      const res = await call("PATCH", `/companies/${c.companyId}`, c.token, { [field]: accountId }, "en");
      expect(res.status, res.text).toBe(400);
      expect(res.body.error).toBe("The shift cash shortage/surplus account must be an active, non-archived posting account of the same company");
    }
    expect((await call("PATCH", `/companies/${c.companyId}`, c.token, { stationCashShortageAccountId: c.acc.shortage })).status).toBe(200);
    const created = await call("POST", "/companies", c.token, { name: `شركة ثالثة ${stamp}`, businessActivity: "fuel_stations", stationCashShortageAccountId: c.acc.shortage });
    expect(created.status, created.text).toBe(400);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: c.companyId } });
    expect([company.stationDieselItemId, company.stationCashShortageAccountId]).toEqual([c.items.diesel, c.acc.shortage]);
    expect((await prisma.warehouse.findFirstOrThrow({ where: { costCenterId: c.station } })).id).toBe(c.warehouseId);
  });

  it("posts cost of sales at weighted average cost in the shift's own entry, and issues the liters from the station warehouse", async () => {
    const c = ctx.a;
    ids.A1 = await reviewedShift(c, "2026-10-06", { diesel: 200, gasoline_91: 30 });
    ids.entryA1 = await approvedAndPosted(c, ids.A1);

    const lines = await entryLines(ids.entryA1);
    // ديزل 200 × 1.50 = 300.00، بنزين 91 30 × 2.00 = 60.00 — مدين التكلفة / دائن مخزون كل صنف، بمركز تكلفة المحطة
    expect(lines).toEqual(expect.arrayContaining([
      { accountId: c.acc.cogs, costCenterId: c.station, debit: 300, credit: 0 },
      { accountId: c.acc.stock114002, costCenterId: c.station, debit: 0, credit: 300 },
      { accountId: c.acc.cogs, costCenterId: c.station, debit: 60, credit: 0 },
      { accountId: c.acc.stock114001, costCenterId: c.station, debit: 0, credit: 60 },
    ]));
    const totals = lines.reduce((s, l) => [s[0] + l.debit, s[1] + l.credit], [0, 0]);
    expect(totals[0]).toBeCloseTo(totals[1], 2);

    const movements = await prisma.stockMovement.findMany({ where: { tenantId: c.tenantId, sourceStationShiftId: ids.A1 }, orderBy: { quantity: "desc" } });
    expect(movements.map((m) => [m.itemId, m.warehouseId, m.type, Number(m.quantity), Number(m.unitCost), m.journalEntryId, m.companyId])).toEqual([
      [c.items.diesel, c.warehouseId, "out", 200, 1.5, ids.entryA1, c.companyId],
      [c.items.gasoline_91, c.warehouseId, "out", 30, 2, ids.entryA1, c.companyId],
    ]);
    expect(await balance(c, c.items.diesel)).toBe(4790);
    expect(await balance(c, c.items.gasoline_91)).toBe(970);
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: c.items.diesel } })).averageCost)).toBe(1.5);
  });

  it("refuses to approve a product whose mapped item has zero average cost", async () => {
    const c = ctx.a;
    ids.Y = await reviewedShift(c, "2026-10-07", { gasoline_95: 5 });
    const res = await approve(c, ids.Y, "en");
    expect(res.status, res.text).toBe(400);
    expect(res.body.error).toBe('The average cost of "Gasoline 95" is zero — enter a purchase invoice for it before posting the shift so the cost of sales can be calculated');
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: ids.Y } })).status).toBe("under_review");
    await shifts.rejectShift(c.tenantId, c.userId, ids.Y, "zero-cost", undefined);
  });

  it("posting keeps its own checks: a configuration change after approval still refuses the post, leaving the shift approved", async () => {
    const c = ctx.a;
    ids.Z = await reviewedShift(c, "2026-10-08", { diesel: 20 });
    expect((await approve(c, ids.Z)).status).toBe(200);
    expect((await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: null })).status).toBe(200);
    const refused = await post(c, ids.Z);
    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.error).toBe(STATION_WAREHOUSE_MISSING);
    const shift = await prisma.stationShift.findUniqueOrThrow({ where: { id: ids.Z } });
    expect([shift.status, shift.journalEntryId]).toEqual(["approved", null]);

    expect((await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: c.warehouseId })).status).toBe(200);
    expect((await post(c, ids.Z)).status).toBe(200);
    expect(await balance(c, c.items.diesel)).toBe(4770);
  });

  it("refuses approval on insufficient stock when negative fuel stock is disallowed, and posts below zero when allowed", async () => {
    const c = ctx.b;
    expect((await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: c.warehouseId })).status).toBe(200);
    expect((await call("PATCH", `/companies/${c.companyId}`, c.token, { stationDieselItemId: c.items.diesel, allowNegativeFuelStock: false })).status).toBe(200);

    const shiftId = await reviewedShift(c, "2026-10-06", { diesel: 74 });
    const refused = await approve(c, shiftId);
    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.error).toBe("الكمية المباعة من «ديزل» في هذه الوردية أكبر من رصيد مستودع المحطة، والرصيد السالب للوقود غير مسموح في إعدادات الشركة");

    expect((await call("PATCH", `/companies/${c.companyId}`, c.token, { allowNegativeFuelStock: true })).status).toBe(200);
    const entry = await approvedAndPosted(c, shiftId);
    expect(await balance(c, c.items.diesel)).toBe(-24);
    // 74 × 1.70 = 125.80 — مبلغ المستأجر B وحده، لا يختلط بأرقام A ذات الاسم نفسه
    expect(await entryLines(entry)).toEqual(expect.arrayContaining([
      { accountId: c.acc.cogs, costCenterId: c.station, debit: 125.8, credit: 0 },
      { accountId: c.acc.stock114002, costCenterId: c.station, debit: 0, credit: 125.8 },
    ]));
    expect(await balance(ctx.a, ctx.a.items.diesel)).toBe(4770);
  });

  it("refuses the generic reverse, unpost, mirror and delete on a station shift entry", async () => {
    const c = ctx.a;
    const before = await entryLines(ids.entryA1);
    const attempts = [
      await call("POST", `/journal-entries/${ids.entryA1}/reverse`, c.token, { date: "2026-10-20" }),
      await call("POST", `/journal-entries/${ids.entryA1}/unpost`, c.token, { pin: PIN }),
      await call("POST", `/journal-entries/${ids.entryA1}/mirror-suggestion`, c.token, { targetCompanyId: otherCompanyA }),
      await call("POST", `/journal-entries/${ids.entryA1}/mirror`, c.token, {
        targetCompanyId: otherCompanyA, date: "2026-10-20",
        lines: [{ accountId: c.acc.cogs, debit: 1, credit: 0 }, { accountId: c.acc.stock114002, debit: 0, credit: 1 }],
      }),
      await call("DELETE", `/journal-entries/${ids.entryA1}`, c.token),
    ];
    for (const res of attempts) {
      expect(res.status, res.text).toBe(400);
      expect(res.body.error).toBe(STATION_SHIFT_ENTRY_LOCKED);
    }
    const en = await call("POST", `/journal-entries/${ids.entryA1}/reverse`, c.token, { date: "2026-10-20" }, "en");
    expect(en.body.error).toContain('use "Reverse shift" on the station shifts screen');

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: ids.entryA1 } });
    expect([entry.status, entry.mirrorEntryId]).toEqual(["posted", null]);
    expect(await entryLines(ids.entryA1)).toEqual(before);
    expect(await prisma.journalEntry.count({ where: { tenantId: c.tenantId, reversalOfEntryId: ids.entryA1 } })).toBe(0);
    expect(await prisma.account.count({ where: { tenantId: c.tenantId, companyId: otherCompanyA, intercompanyCompanyId: c.companyId } })).toBe(0);
  });

  it("isolates tenants: another tenant cannot list, reverse or correct the shift", async () => {
    const list = await call("GET", `/station-shifts/posted?companyId=${ctx.a.companyId}`, ctx.b.token);
    expect(Array.isArray(list.body) ? list.body.some((s: { id: string }) => s.id === ids.A1) : false).toBe(false);
    expect((await call("POST", `/station-shifts/${ids.A1}/reverse`, ctx.b.token, { reason: "محاولة" })).status).toBe(404);
    expect((await call("POST", `/station-shifts/${ids.Y}/corrected-shift`, ctx.b.token, { readings: [{ nozzleId: "x", closingReading: 1 }] })).status).toBe(404);
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: ids.A1 } })).status).toBe("posted");
  });

  it("reverses a posted shift in one step: reversal entry, stock restored, status reversed, audited — and never re-posted", async () => {
    const c = ctx.a;
    expect((await call("POST", `/station-shifts/${ids.A1}/reverse`, c.token, { reason: "   " })).status).toBe(400);

    const listed = await call("GET", `/station-shifts/posted?companyId=${c.companyId}`, c.token);
    expect(listed.status, listed.text).toBe(200);
    const statuses = new Map(listed.body.map((s: { id: string; status: string }) => [s.id, s.status]));
    expect([statuses.get(ids.A1), statuses.get(ids.Y)]).toEqual(["posted", "rejected"]);

    const res = await call("POST", `/station-shifts/${ids.A1}/reverse`, c.token, { reason: "قراءة عداد خاطئة", date: "2026-10-21" });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("reversed");

    const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId: c.tenantId, reversalOfEntryId: ids.entryA1 } });
    expect([reversal.companyId, reversal.status, reversal.sourceModule, reversal.sourceId, reversal.date.toISOString().slice(0, 10)])
      .toEqual([c.companyId, "posted", "station_shift", ids.A1, "2026-10-21"]);
    // نفس الأسطر بالاتجاه المعاكس (مقارنة كمجموعة — ترتيب معرّفات أسطر الإنشاء المتداخل غير مضمون)
    const withCostCenter = (lines: Awaited<ReturnType<typeof entryLines>>) => lines.map((l) => `${l.costCenterId}|${l.accountId}|${l.debit.toFixed(2)}|${l.credit.toFixed(2)}`).sort();
    const swapped = (await entryLines(reversal.id)).map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
    expect(withCostCenter(swapped)).toEqual(withCostCenter(await entryLines(ids.entryA1)));

    expect(await prisma.stockMovement.count({ where: { sourceStationShiftId: ids.A1 } })).toBe(0);
    expect(await balance(c, c.items.diesel)).toBe(4970);
    expect(await balance(c, c.items.gasoline_91)).toBe(1000);

    const audit = await prisma.stationShiftAuditLog.findMany({ where: { shiftId: ids.A1, action: "reverse" } });
    expect(audit.map((a) => [a.fieldName, a.newValue, a.userId]).sort()).toEqual([
      ["reversalEntryId", reversal.id, c.userId],
      ["reversalReason", "قراءة عداد خاطئة", c.userId],
      ["status", "reversed", c.userId],
    ]);

    expect((await post(c, ids.A1)).status).toBe(400);
    expect((await call("POST", `/station-shifts/${ids.A1}/reverse`, c.token, { reason: "مرة ثانية" })).status).toBe(400);
    expect((await call("POST", `/journal-entries/${reversal.id}/reverse`, c.token, { date: "2026-10-22" })).status).toBe(400);
    expect(await balance(ctx.b, ctx.b.items.diesel)).toBe(-24);
  });

  it("enters a corrected shift in place of a rejected one: same slot, opening from the rejected shift's opening, under review", async () => {
    const c = ctx.a;
    const rejected = await readingsOf(ids.Y);
    const res = await call("POST", `/station-shifts/${ids.Y}/corrected-shift`, c.token, {
      readings: rejected.map((r) => ({ nozzleId: r.nozzleId, closingReading: Number(r.accountantConfirmedValue) })),
    });
    expect(res.status, res.text).toBe(201);
    const corrected = await prisma.stationShift.findUniqueOrThrow({ where: { id: res.body.id } });
    expect([corrected.status, corrected.correctsShiftId, corrected.costCenterId, corrected.shiftDate.toISOString().slice(0, 10), corrected.shiftType, corrected.companyId])
      .toEqual(["under_review", ids.Y, c.station, "2026-10-07", "morning", c.companyId]);
    const readings = await readingsOf(corrected.id);
    expect(readings.map((r) => [r.nozzleId, Number(r.openingReading), Number(r.accountantConfirmedValue)]))
      .toEqual(rejected.map((r) => [r.nozzleId, Number(r.openingReading), Number(r.accountantConfirmedValue)]));
    expect(await prisma.stationShiftAuditLog.count({ where: { shiftId: corrected.id, action: "create_corrected", userId: c.userId, newValue: ids.Y } })).toBe(1);

    // الخانة مشغولة الآن بوردية قائمة — وردية مصحَّحة ثانية لنفس الخانة مرفوضة
    expect((await call("POST", `/station-shifts/${ids.Y}/corrected-shift`, c.token, { readings: rejected.map((r) => ({ nozzleId: r.nozzleId, closingReading: Number(r.accountantConfirmedValue) })) })).status).toBe(400);

    // سبب الرفض عولج (شراء 95 بـ2.10) — تُعتمَد بصور عدادات الوردية المرفوضة وتُرحَّل: 5 × 2.10 = 10.50
    await buy(c, c.items.gasoline_95, 1000, 2.1);
    ids.Yc = corrected.id;
    const entry = await approvedAndPosted(c, corrected.id);
    expect(await entryLines(entry)).toEqual(expect.arrayContaining([
      { accountId: c.acc.cogs, costCenterId: c.station, debit: 10.5, credit: 0 },
      { accountId: c.acc.stock114001, costCenterId: c.station, debit: 0, credit: 10.5 },
    ]));
    expect(await balance(c, c.items.gasoline_95)).toBe(995);
  });

  it("lets a worker reopen a slot freed by a rejected shift, but not an occupied one", async () => {
    const c = ctx.b;
    const first = await shifts.openShift(c.tenantId, c.employeeId, { shiftType: "night" });
    await shifts.submitShift(c.tenantId, c.employeeId, first.id);
    await shifts.rejectShift(c.tenantId, c.userId, first.id, "wrong", undefined);
    const second = await shifts.openShift(c.tenantId, c.employeeId, { shiftType: "night" });
    expect(second.id).not.toBe(first.id);
    expect(second.shiftDate.toISOString()).toBe(first.shiftDate.toISOString());
    await expect(shifts.openShift(c.tenantId, c.employeeId, { shiftType: "night" })).rejects.toThrow("توجد وردية بالفعل لهذه المحطة بنفس التاريخ ونوع الوردية");
    // والفهرس الجزئي نفسه يرفض وردية قائمة ثانية في الخانة حتى خارج الخدمة
    await expect(prisma.stationShift.create({
      data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.station, stationUserId: c.employeeId, shiftDate: second.shiftDate, shiftType: "night", status: "open" },
    })).rejects.toMatchObject({ code: "P2002" });
  });

  it("refuses a corrected shift whose closing breaks the meter chain with the next live shift, naming the mismatch", async () => {
    const c = ctx.a;
    const original = await readingsOf(ids.A1);
    const body = {
      readings: original.map((r) => ({ nozzleId: r.nozzleId, closingReading: Number(r.accountantConfirmedValue) + (r.nozzle.product === "diesel" && r.nozzle.nozzleNumber === 1 ? -50 : 0) })),
    };
    const res = await call("POST", `/station-shifts/${ids.A1}/corrected-shift`, c.token, body);
    expect(res.status, res.text).toBe(400);
    expect(res.body.error).toBe("قراءة إغلاق الوردية المصحَّحة لا تطابق قراءة افتتاح الوردية التالية لنفس المحطة — اعكس الورديات اللاحقة وصحّحها بالترتيب أولاً");
    // الوردية التالية القائمة هي Y' المصحَّحة المرحَّلة (Y نفسها مرفوضة فلا تُحتسَب)
    expect(res.body.details.laterShiftId).toBe(ids.Yc);
    expect(res.body.details.mismatches).toHaveLength(1);
    expect(res.body.details.mismatches[0].nozzle).toBe("1-1");
    const en = await call("POST", `/station-shifts/${ids.A1}/corrected-shift`, c.token, body, "en");
    expect(en.body.error).toBe("The corrected shift's closing reading doesn't match the opening reading of the next shift at the same station — reverse and correct the later shifts in order first");
    expect(await prisma.stationShift.count({ where: { correctsShiftId: ids.A1 } })).toBe(0);
  });

  it("enters a corrected shift for a reversed one and takes it through review, approval (meter photos of the replaced shift) and posting", async () => {
    const c = ctx.a;
    const original = await readingsOf(ids.A1);
    const res = await call("POST", `/station-shifts/${ids.A1}/corrected-shift`, c.token, {
      readings: original.map((r) => ({ nozzleId: r.nozzleId, closingReading: Number(r.accountantConfirmedValue) })),
      collection: { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 500 },
    });
    expect(res.status, res.text).toBe(201);
    const correctedId = res.body.id as string;
    expect((await readingsOf(correctedId)).map((r) => Number(r.openingReading))).toEqual(original.map((r) => Number(r.openingReading)));
    // لا صورة على القراءات المصحَّحة نفسها — صور الوردية المعكوسة لنفس الفوهات هي الإثبات
    expect(await prisma.attachment.count({ where: { tenantId: c.tenantId, entityId: { in: (await readingsOf(correctedId)).map((r) => r.id) } } })).toBe(0);

    const preview = (await call("GET", `/station-shifts/${correctedId}`, c.token)).body.summary;
    expect(preview.cogsError).toBeNull();
    expect(sortLines(preview.cogsLines)).toEqual(sortLines([
      { accountId: c.acc.cogs, debit: 300, credit: 0 }, { accountId: c.acc.stock114002, debit: 0, credit: 300 },
      { accountId: c.acc.cogs, debit: 60, credit: 0 }, { accountId: c.acc.stock114001, debit: 0, credit: 60 },
    ]));

    const entry = await approvedAndPosted(c, correctedId);
    const lines = await entryLines(entry);
    expect(sortLines(lines)).toEqual(sortLines(preview.lines));
    expect(lines.filter((l) => l.debit === 500)).toHaveLength(1); // التحصيل المصحَّح
    expect(await balance(c, c.items.diesel)).toBe(4770);
    expect(await balance(c, c.items.gasoline_91)).toBe(970);
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: ids.A1 } })).status).toBe("reversed");
  });

  it("keeps a posted shift's unit cost as a snapshot: a later purchase changes the average but not the issued movement", async () => {
    const c = ctx.b;
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { tenantId: c.tenantId, sourceStationShiftId: { not: null } } });
    await buy(c, c.items.diesel, 1000, 2.2);
    expect(Number((await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).unitCost)).toBe(1.7);
    expect(new Prisma.Decimal((await prisma.item.findUniqueOrThrow({ where: { id: c.items.diesel } })).averageCost).toNumber()).toBe(2.2);
  });
});
