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
 * تكلفة الوقود عند ترحيل وردية المحطة، وعكس الوردية، وحماية قيدها — على Postgres حقيقي وعبر مسارات HTTP الفعلية
 * (الترحيل، العكس، إعدادات الشركة، ربط مستودع المحطة، العكس/فك الترحيل/المرآة العامة). القيود وحركات المخزون التي
 * تُفحَص يُنتجها الكود نفسه (postShift/reverseShift، فاتورة شراء حقيقية لمتوسط التكلفة) — CLAUDE.md القاعدة 2؛ ما
 * يُصنَع يدوياً هو ما يصل من خارج النظام فقط: صفّ الوردية المفتوحة بتاريخ مختار (فتح العامل يأخذ تاريخ اليوم دائماً،
 * والقيد الفريد يسمح بورديتين فقط لكل محطة في اليوم) وصفّ صورة العداد (رفع ملف).
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بمبالغ مختلفة، ليظهر أي دمج بين الشركات في الأرقام.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `محطات مشتركة ${stamp}`;
const PIN = "4826";
let server: Server;
let baseUrl = "";

interface Ctx {
  key: "a" | "b";
  email: string;
  token: string;
  userId: string;
  tenantId: string;
  companyId: string;
  station: string;
  employeeId: string;
  warehouseId: string;
  items: { diesel: string; gasoline_91: string; gasoline_95: string };
  acc: { stock114001: string; stock114002: string; cogs: string };
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
  const employeeId = (await prisma.employee.create({
    data: { tenantId, companyId: company.id, name: "عامل المحطة", hireDate: new Date("2026-01-01"), basicSalary: 3000, assignedCostCenterId: station },
  })).id;
  // البيانات الابتدائية لنشاط المحطات: أصناف 0001/0002/0003 ومستودع افتراضي (src/lib/starterData.ts)
  const itemByCode = async (code: string) => (await prisma.item.findFirstOrThrow({ where: { tenantId, companyId: company.id, code } })).id;
  const accByCode = async (code: string) => (await prisma.account.findFirstOrThrow({ where: { tenantId, companyId: company.id, code } })).id;
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { tenantId, companyId: company.id, isDefault: true } })).id;
  return {
    key, email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, warehouseId,
    items: { gasoline_91: await itemByCode("0001"), gasoline_95: await itemByCode("0002"), diesel: await itemByCode("0003") },
    acc: { stock114001: await accByCode("114001"), stock114002: await accByCode("114002"), cogs: await accByCode("511001") },
  };
}

async function buy(c: Ctx, itemId: string, quantity: number, unitPrice: number) {
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: c.companyId } });
  await createPurchaseInvoice(c.tenantId, c.userId, {
    companyId: c.companyId, supplierId: supplier.id, date: day("2026-10-01"),
    lines: [{ accountId: "derived-from-item", itemId, warehouseId: c.warehouseId, quantity, unitPrice }],
  } as never);
}

/** وردية حتى "approved" عبر مسارات الخدمة الحقيقية: قراءات، صور، تحصيل، إرسال، تصحيح المحاسب، اعتماد. */
async function approvedShift(c: Ctx, date: string, litersByProduct: Partial<Record<"diesel" | "gasoline_91" | "gasoline_95", number>>, costCenterId = c.station) {
  const shift = await prisma.stationShift.create({
    data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId, employeeId: c.employeeId, shiftDate: day(date), shiftType: "morning", openedAt: new Date(), status: "open" },
  });
  const nozzles = await prisma.stationNozzle.findMany({ where: { tenantId: c.tenantId, costCenterId, isActive: true }, orderBy: [{ pumpNumber: "asc" }, { nozzleNumber: "asc" }] });
  const readings: { id: string; product: keyof typeof litersByProduct }[] = [];
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
  await shifts.approveShift(c.tenantId, c.userId, shift.id);
  return shift.id;
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

describe("station shift cost of sales, shift reversal and entry protection (integration)", () => {
  let shiftA1 = "";
  let entryA1 = "";
  let otherCompanyA = "";

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a");
    ctx.b = await setupTenant("b");

    // المستأجر A: ديزل 5000 لتر بـ1.50، بنزين 91 ألف لتر بـ2.00، بنزين 95 بلا أي شراء (متوسط صفر)
    await buy(ctx.a, ctx.a.items.diesel, 5000, 1.5);
    await buy(ctx.a, ctx.a.items.gasoline_91, 1000, 2);
    // المستأجر B: ديزل 50 لتراً فقط بـ1.70 (لاختبار الرصيد السالب)
    await buy(ctx.b, ctx.b.items.diesel, 50, 1.7);

    // شركة ثانية داخل مستأجر A — لاختبار رفض ربط صنفها/مستودعها بشركة A
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

  it("refuses posting while the station has no warehouse or a product has no mapped item — the shift stays approved with no entry", async () => {
    const c = ctx.a;
    const shiftId = await approvedShift(c, "2026-10-05", { diesel: 10 });

    const noMapping = await call("POST", `/station-shifts/${shiftId}/post`, c.token);
    expect(noMapping.status, noMapping.text).toBe(400);
    expect(noMapping.body.error).toContain("لم يُربَط صنف مخزون بمنتج «ديزل»");

    const map = await call("PATCH", `/companies/${c.companyId}`, c.token, {
      stationDieselItemId: c.items.diesel, stationGasoline91ItemId: c.items.gasoline_91, stationGasoline95ItemId: c.items.gasoline_95,
    });
    expect(map.status, map.text).toBe(200);

    const noWarehouse = await call("POST", `/station-shifts/${shiftId}/post`, c.token, undefined, "en");
    expect(noWarehouse.status, noWarehouse.text).toBe(400);
    expect(noWarehouse.body.error).toBe("No warehouse is set for this station — link a warehouse to the station in station setup before posting the shift");

    const shift = await prisma.stationShift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe("approved");
    expect(shift.journalEntryId).toBeNull();
    expect(await prisma.journalEntry.count({ where: { tenantId: c.tenantId, sourceModule: "station_shift", sourceId: shiftId } })).toBe(0);
    await shifts.rejectShift(c.tenantId, c.userId, shiftId, "test", undefined);
    expect(STATION_WAREHOUSE_MISSING).toContain("لم يُحدَّد مستودع");
  });

  it("refuses to link another company's item or warehouse, even inside the same tenant", async () => {
    const c = ctx.a;
    const foreignItem = await prisma.item.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: otherCompanyA, code: "0003" } });
    const foreignWarehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenantId: c.tenantId, companyId: otherCompanyA } });
    const badItem = await call("PATCH", `/companies/${c.companyId}`, c.token, { stationDieselItemId: foreignItem.id });
    expect(badItem.status, badItem.text).toBe(400);
    expect(badItem.body.error).toBe("صنف الوقود المختار غير موجود ضمن هذه الشركة");
    const crossTenantItem = await call("PATCH", `/companies/${c.companyId}`, c.token, { stationDieselItemId: ctx.b.items.diesel });
    expect(crossTenantItem.status).toBe(400);

    const badWarehouse = await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: foreignWarehouse.id });
    expect(badWarehouse.status, badWarehouse.text).toBe(400);
    expect(badWarehouse.body.error).toBe("المستودع غير موجود ضمن هذه الشركة");
    const crossTenantWarehouse = await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: ctx.b.warehouseId });
    expect(crossTenantWarehouse.status).toBe(400);

    expect((await prisma.company.findUniqueOrThrow({ where: { id: c.companyId } })).stationDieselItemId).toBe(c.items.diesel);
    expect(await prisma.warehouse.count({ where: { costCenterId: c.station } })).toBe(0);
  });

  it("posts cost of sales at weighted average cost in the shift's own entry, and issues the liters from the station warehouse", async () => {
    const c = ctx.a;
    const link = await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: c.warehouseId });
    expect(link.status, link.text).toBe(200);

    shiftA1 = await approvedShift(c, "2026-10-06", { diesel: 200, gasoline_91: 30 });
    const posted = await call("POST", `/station-shifts/${shiftA1}/post`, c.token);
    expect(posted.status, posted.text).toBe(200);
    entryA1 = posted.body.journalEntryId;

    const lines = await entryLines(entryA1);
    // ديزل 200 × 1.50 = 300.00، بنزين 91 30 × 2.00 = 60.00 — مدين التكلفة / دائن مخزون كل صنف، بمركز تكلفة المحطة
    expect(lines).toEqual(expect.arrayContaining([
      { accountId: c.acc.cogs, costCenterId: c.station, debit: 300, credit: 0 },
      { accountId: c.acc.stock114002, costCenterId: c.station, debit: 0, credit: 300 },
      { accountId: c.acc.cogs, costCenterId: c.station, debit: 60, credit: 0 },
      { accountId: c.acc.stock114001, costCenterId: c.station, debit: 0, credit: 60 },
    ]));
    const totals = lines.reduce((s, l) => [s[0] + l.debit, s[1] + l.credit], [0, 0]);
    expect(totals[0]).toBeCloseTo(totals[1], 2);

    const movements = await prisma.stockMovement.findMany({ where: { tenantId: c.tenantId, sourceStationShiftId: shiftA1 }, orderBy: { quantity: "desc" } });
    expect(movements.map((m) => [m.itemId, m.warehouseId, m.type, Number(m.quantity), Number(m.unitCost), m.journalEntryId, m.companyId])).toEqual([
      [c.items.diesel, c.warehouseId, "out", 200, 1.5, entryA1, c.companyId],
      [c.items.gasoline_91, c.warehouseId, "out", 30, 2, entryA1, c.companyId],
    ]);
    expect(await balance(c, c.items.diesel)).toBe(4800);
    expect(await balance(c, c.items.gasoline_91)).toBe(970);
    // متوسط التكلفة لا يتغيّر بالصرف
    expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: c.items.diesel } })).averageCost)).toBe(1.5);
  });

  it("refuses a product whose mapped item has zero average cost", async () => {
    const c = ctx.a;
    const shiftId = await approvedShift(c, "2026-10-07", { gasoline_95: 5 });
    const res = await call("POST", `/station-shifts/${shiftId}/post`, c.token, undefined, "en");
    expect(res.status, res.text).toBe(400);
    expect(res.body.error).toBe('The average cost of "Gasoline 95" is zero — enter a purchase invoice for it before posting the shift so the cost of sales can be calculated');
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: shiftId } })).status).toBe("approved");
    expect(await prisma.stockMovement.count({ where: { sourceStationShiftId: shiftId } })).toBe(0);
    await shifts.rejectShift(c.tenantId, c.userId, shiftId, "test", undefined);
  });

  it("refuses insufficient stock when the company disallows negative fuel stock, and allows it when permitted", async () => {
    const c = ctx.b;
    expect((await call("PUT", `/station-setup/stations/${c.station}/warehouse`, c.token, { companyId: c.companyId, warehouseId: c.warehouseId })).status).toBe(200);
    const settings = await call("PATCH", `/companies/${c.companyId}`, c.token, { stationDieselItemId: c.items.diesel, allowNegativeFuelStock: false });
    expect(settings.status, settings.text).toBe(200);

    const shiftId = await approvedShift(c, "2026-10-06", { diesel: 74 });
    const refused = await call("POST", `/station-shifts/${shiftId}/post`, c.token);
    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.error).toContain("أكبر من رصيد مستودع المحطة");
    expect(await balance(c, c.items.diesel)).toBe(50);

    expect((await call("PATCH", `/companies/${c.companyId}`, c.token, { allowNegativeFuelStock: true })).status).toBe(200);
    const posted = await call("POST", `/station-shifts/${shiftId}/post`, c.token);
    expect(posted.status, posted.text).toBe(200);
    expect(await balance(c, c.items.diesel)).toBe(-24);
    // 74 × 1.70 = 125.80 — مبلغ المستأجر B وحده، لا يختلط بأرقام A ذات الاسم نفسه
    expect(await entryLines(posted.body.journalEntryId)).toEqual(expect.arrayContaining([
      { accountId: c.acc.cogs, costCenterId: c.station, debit: 125.8, credit: 0 },
      { accountId: c.acc.stock114002, costCenterId: c.station, debit: 0, credit: 125.8 },
    ]));
    expect(await balance(ctx.a, ctx.a.items.diesel)).toBe(4800);
  });

  it("refuses the generic reverse, unpost, edit, delete and mirror on a station shift entry", async () => {
    const c = ctx.a;
    const before = await entryLines(entryA1);
    const attempts = [
      await call("POST", `/journal-entries/${entryA1}/reverse`, c.token, { date: "2026-10-20" }),
      await call("POST", `/journal-entries/${entryA1}/unpost`, c.token, { pin: PIN }),
      await call("POST", `/journal-entries/${entryA1}/mirror-suggestion`, c.token, { targetCompanyId: otherCompanyA }),
      await call("POST", `/journal-entries/${entryA1}/mirror`, c.token, {
        targetCompanyId: otherCompanyA, date: "2026-10-20",
        lines: [{ accountId: c.acc.cogs, debit: 1, credit: 0 }, { accountId: c.acc.stock114002, debit: 0, credit: 1 }],
      }),
      await call("DELETE", `/journal-entries/${entryA1}`, c.token),
    ];
    for (const res of attempts) {
      expect(res.status, res.text).toBe(400);
      expect(res.body.error).toBe(STATION_SHIFT_ENTRY_LOCKED);
    }
    const en = await call("POST", `/journal-entries/${entryA1}/reverse`, c.token, { date: "2026-10-20" }, "en");
    expect(en.body.error).toContain('use "Reverse shift" on the station shifts screen');

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entryA1 } });
    expect([entry.status, entry.mirrorEntryId]).toEqual(["posted", null]);
    expect(await entryLines(entryA1)).toEqual(before);
    expect(await prisma.journalEntry.count({ where: { tenantId: c.tenantId, reversalOfEntryId: entryA1 } })).toBe(0);
    expect(await prisma.account.count({ where: { tenantId: c.tenantId, companyId: otherCompanyA, intercompanyCompanyId: c.companyId } })).toBe(0);
  });

  it("isolates tenants: another tenant cannot list or reverse the shift", async () => {
    const list = await call("GET", `/station-shifts/posted?companyId=${ctx.a.companyId}`, ctx.b.token);
    expect((list.body ?? []).some?.((s: { id: string }) => s.id === shiftA1) ?? false).toBe(false);
    const res = await call("POST", `/station-shifts/${shiftA1}/reverse`, ctx.b.token, { reason: "محاولة" });
    expect(res.status).toBe(404);
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: shiftA1 } })).status).toBe("posted");
  });

  it("reverses a posted shift in one step: reversal entry, stock restored, status reversed, audited — and never re-posted", async () => {
    const c = ctx.a;
    expect((await call("POST", `/station-shifts/${shiftA1}/reverse`, c.token, { reason: "   " })).status).toBe(400);

    const listed = await call("GET", `/station-shifts/posted?companyId=${c.companyId}`, c.token);
    expect(listed.status, listed.text).toBe(200);
    expect(listed.body.map((s: { id: string; status: string }) => [s.id, s.status])).toContainEqual([shiftA1, "posted"]);

    const res = await call("POST", `/station-shifts/${shiftA1}/reverse`, c.token, { reason: "قراءة عداد خاطئة", date: "2026-10-21" });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("reversed");

    const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId: c.tenantId, reversalOfEntryId: entryA1 } });
    expect([reversal.companyId, reversal.status, reversal.sourceModule, reversal.sourceId, reversal.date.toISOString().slice(0, 10)])
      .toEqual([c.companyId, "posted", "station_shift", shiftA1, "2026-10-21"]);
    const original = await entryLines(entryA1);
    const swapped = (await entryLines(reversal.id)).map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
    expect(swapped).toEqual(original);
    expect(Number(reversal.totalDebit)).toBe(Number((await prisma.journalEntry.findUniqueOrThrow({ where: { id: entryA1 } })).totalDebit));

    expect(await prisma.stockMovement.count({ where: { sourceStationShiftId: shiftA1 } })).toBe(0);
    expect(await balance(c, c.items.diesel)).toBe(5000);
    expect(await balance(c, c.items.gasoline_91)).toBe(1000);

    const audit = await prisma.stationShiftAuditLog.findMany({ where: { shiftId: shiftA1, action: "reverse" } });
    expect(audit.map((a) => [a.fieldName, a.newValue, a.userId]).sort()).toEqual([
      ["reversalEntryId", reversal.id, c.userId],
      ["reversalReason", "قراءة عداد خاطئة", c.userId],
      ["status", "reversed", c.userId],
    ]);

    expect((await call("POST", `/station-shifts/${shiftA1}/post`, c.token)).status).toBe(400);
    expect((await call("POST", `/station-shifts/${shiftA1}/reverse`, c.token, { reason: "مرة ثانية" })).status).toBe(400);
    // قيد العكس نفسه محمي كذلك — عكسه من شاشة القيود لن يعيد الوردية ولا مخزونها
    expect((await call("POST", `/journal-entries/${reversal.id}/reverse`, c.token, { date: "2026-10-22" })).status).toBe(400);
    expect(await prisma.journalEntry.count({ where: { tenantId: c.tenantId, sourceId: shiftA1 } })).toBe(2);
    // B لم يتأثر
    expect(await balance(ctx.b, ctx.b.items.diesel)).toBe(-24);
  });

  it("keeps a posted shift's unit cost as a snapshot: a later purchase changes the average but not the issued movement", async () => {
    const c = ctx.b;
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { tenantId: c.tenantId, sourceStationShiftId: { not: null } } });
    await buy(c, c.items.diesel, 1000, 2.2);
    expect(Number((await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).unitCost)).toBe(1.7);
    expect(new Prisma.Decimal((await prisma.item.findUniqueOrThrow({ where: { id: c.items.diesel } })).averageCost).toNumber()).toBe(2.2);
  });
});
