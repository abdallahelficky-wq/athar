import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createPurchaseInvoice } from "../purchaseInvoices/purchaseInvoices.service";
import * as shifts from "../stationShifts/stationShifts.service";

/**
 * الخزانات والتوريد — على Postgres حقيقي وعبر مسارات HTTP الفعلية (/station-tanks). المبيعات في المطابقة تأتي من ورديات
 * حقيقية تمرّ بالخدمة (قراءات، إرسال، تصحيح المحاسب، اعتماد عبر HTTP) — CLAUDE.md القاعدة 2. المصنوع يدوياً: صفّ الوردية
 * المفتوحة فقط (فتح العامل له تاريخ اليوم دائماً على أي حال).
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بأرقام مختلفة: A سليم ضمن السماحية، B مخالفة — أي خلط يظهر في الأرقام فوراً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `خزانات ${stamp}`;
let server: Server;
let baseUrl = "";

interface Ctx {
  email: string;
  token: string;
  userId: string;
  tenantId: string;
  companyId: string;
  station: string;
  employeeId: string;
  nozzles: string[];
  tankId: string;
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

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `tanks-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `خزانات ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const token = r.accessToken;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "المحطة 1" } })).id;

  for (const pumpType of ["diesel", "petrol"] as const) {
    const pump = await call("POST", "/station-setup/pumps", token, {
      companyId: company.id, costCenterId: station, pumpType, meterType: "electronic", hasMoneyMeter: false,
      nozzles: [{ meterDigits: 7, initialReading: 1000 }, { meterDigits: 7, initialReading: 2000 }],
    });
    expect(pump.status, pump.text).toBe(201);
  }
  for (const [product, price] of [["diesel", 2.3], ["gasoline_91", 2.18], ["gasoline_95", 2.33]] as const) {
    expect((await call("POST", "/station-setup/fuel-prices", token, { companyId: company.id, product, priceInclVat: price, effectiveFrom: "2026-01-01" })).status).toBe(201);
  }
  const employeeId = (await prisma.employee.create({
    data: { tenantId, companyId: company.id, name: "عامل المحطة", hireDate: new Date("2026-01-01"), basicSalary: 3000, assignedCostCenterId: station },
  })).id;
  const item = async (code: string) => (await prisma.item.findFirstOrThrow({ where: { tenantId, companyId: company.id, code } })).id;
  const diesel = await item("0003");
  expect((await call("PATCH", `/companies/${company.id}`, token, { stationDieselItemId: diesel, stationGasoline91ItemId: await item("0001"), stationGasoline95ItemId: await item("0002") })).status).toBe(200);
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { tenantId, companyId: company.id, isDefault: true } })).id;
  expect((await call("PUT", `/station-setup/stations/${station}/warehouse`, token, { companyId: company.id, warehouseId })).status).toBe(200);
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId, companyId: company.id } });
  await createPurchaseInvoice(tenantId, r.user.id, {
    companyId: company.id, supplierId: supplier.id, date: new Date("2026-10-01"),
    lines: [{ accountId: "derived-from-item", itemId: diesel, warehouseId, quantity: 5000, unitPrice: 1.5 }],
  } as never);
  const nozzles = (await prisma.stationNozzle.findMany({ where: { tenantId, costCenterId: station, product: "diesel" }, orderBy: { nozzleNumber: "asc" } })).map((n) => n.id);
  return { email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, nozzles, tankId: "" };
}

/** وردية ديزل معتمَدة عبر مسارات الخدمة وHTTP الحقيقية — كل اللترات على أول فوهة ديزل. */
async function approvedDieselShift(c: Ctx, liters: number) {
  const shift = await prisma.stationShift.create({
    data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.station, employeeId: c.employeeId, shiftDate: new Date(`${riyadhCalendarDay(new Date())}T00:00:00.000Z`), shiftType: "morning", openedAt: new Date(), status: "open" },
  });
  const all = await prisma.stationNozzle.findMany({ where: { tenantId: c.tenantId, costCenterId: c.station, isActive: true } });
  const readingIds: { id: string; nozzleId: string }[] = [];
  for (const n of all) {
    const reading = await shifts.submitReading(c.tenantId, c.employeeId, shift.id, { nozzleId: n.id, capturedAt: new Date() });
    await prisma.attachment.create({ data: { tenantId: c.tenantId, entityType: "station_shift_reading", entityId: reading.id, fileName: "meter.jpg", fileKey: `k-${reading.id}`, fileSize: 1, mimeType: "image/jpeg" } });
    readingIds.push({ id: reading.id, nozzleId: n.id });
  }
  await shifts.updateCollections(c.tenantId, c.employeeId, shift.id, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 0 });
  await shifts.submitShift(c.tenantId, c.employeeId, shift.id);
  for (const r of readingIds) {
    const row = await prisma.stationShiftReading.findUniqueOrThrow({ where: { id: r.id } });
    await shifts.correctReading(c.tenantId, c.userId, shift.id, r.id, Number(row.openingReading) + (r.nozzleId === c.nozzles[0] ? liters : 0));
  }
  const approved = await call("POST", `/station-shifts/${shift.id}/approve`, c.token);
  expect(approved.status, approved.text).toBe(200);
  return shift.id;
}

const range = () => ({ from: riyadhCalendarDay(new Date(Date.now() - 86_400_000)), to: riyadhCalendarDay(new Date(Date.now() + 86_400_000)) });

describe("station tanks, dips, deliveries and reconciliation (integration)", () => {
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
      await prisma.stationShift.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.fuelDelivery.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tankReading.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationNozzle.updateMany({ where: { tenantId: c.tenantId }, data: { tankId: null } });
      await prisma.stationTank.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("creates a tank per station and links only same-station, same-product nozzles", async () => {
    for (const key of ["a", "b"] as const) {
      const c = ctx[key];
      const tank = await call("POST", "/station-tanks/tanks", c.token, { companyId: c.companyId, costCenterId: c.station, code: "T1", product: "diesel", capacityLiters: 20000, atgTankNumber: 1 });
      expect(tank.status, tank.text).toBe(201);
      c.tankId = tank.body.id;
      for (const n of c.nozzles) expect((await call("PUT", `/station-tanks/nozzles/${n}/tank`, c.token, { tankId: c.tankId })).status).toBe(200);
    }
    const a = ctx.a;
    const dup = await call("POST", "/station-tanks/tanks", a.token, { companyId: a.companyId, costCenterId: a.station, code: "T1", product: "diesel", capacityLiters: 1 });
    expect(dup.status).toBe(400);
    const petrolNozzle = await prisma.stationNozzle.findFirstOrThrow({ where: { tenantId: a.tenantId, costCenterId: a.station, product: "gasoline_91" } });
    const mismatch = await call("PUT", `/station-tanks/nozzles/${petrolNozzle.id}/tank`, a.token, { tankId: a.tankId }, "en");
    expect(mismatch.status, mismatch.text).toBe(400);
    expect(mismatch.body.error).toBe("The tank's product doesn't match the nozzle's product");
    // خزان مستأجر آخر: لا يصل إليه
    expect((await call("PUT", `/station-tanks/nozzles/${a.nozzles[0]}/tank`, a.token, { tankId: ctx.b.tankId })).status).toBe(404);
  });

  it("refuses a dip above capacity and a dip on another tenant's tank", async () => {
    const a = ctx.a;
    expect((await call("POST", "/station-tanks/readings", a.token, { tankId: a.tankId, purpose: "spot", readAt: hoursFromNow(-3), liters: 25000 })).status).toBe(400);
    expect((await call("POST", "/station-tanks/readings", ctx.b.token, { tankId: a.tankId, purpose: "spot", readAt: hoursFromNow(-3), liters: 100 })).status).toBe(404);
  });

  it("reconciles opening + received − sold against the closing dip, per tenant, ignoring voided dips", async () => {
    // A: افتتاح 10000، توريد مستلَم 5000 (السند 5050)، وردية تبيع 200 → متوقع 14800، إقفال 14790 → عجز 10 ضمن السماحية (50)
    const a = ctx.a;
    expect((await call("POST", "/station-tanks/readings", a.token, { tankId: a.tankId, purpose: "opening", readAt: hoursFromNow(-2), liters: 10000 })).status).toBe(201);
    const delivery = await call("POST", "/station-tanks/deliveries", a.token, {
      companyId: a.companyId, costCenterId: a.station, deliveryNoteNumber: `DN-${stamp}`, deliveredAt: hoursFromNow(-1),
      lines: [{ tankId: a.tankId, noteLiters: 5050, receivedLiters: 5000 }],
    });
    expect(delivery.status, delivery.text).toBe(201);
    const dupNote = await call("POST", "/station-tanks/deliveries", a.token, {
      companyId: a.companyId, costCenterId: a.station, deliveryNoteNumber: `DN-${stamp}`, deliveredAt: hoursFromNow(-1),
      lines: [{ tankId: a.tankId, noteLiters: 1, receivedLiters: 1 }],
    });
    expect(dupNote.status).toBe(400);
    await approvedDieselShift(a, 200);
    // قياس خاطئ ثم إلغاؤه — يجب ألا يدخل المطابقة
    const wrong = await call("POST", "/station-tanks/readings", a.token, { tankId: a.tankId, purpose: "closing", readAt: hoursFromNow(1.5), liters: 1 });
    expect(wrong.status).toBe(201);
    expect((await call("POST", `/station-tanks/readings/${wrong.body.id}/void`, a.token, { reason: "قياس خاطئ" })).status).toBe(200);
    expect((await call("POST", "/station-tanks/readings", a.token, { tankId: a.tankId, purpose: "closing", readAt: hoursFromNow(1), liters: 14790 })).status).toBe(201);

    // B: افتتاح 3000، وردية تبيع 70 → متوقع 2930، إقفال 2800 → عجز 130 > ضعف السماحية (100) → مخالفة
    const b = ctx.b;
    expect((await call("POST", "/station-tanks/readings", b.token, { tankId: b.tankId, purpose: "opening", readAt: hoursFromNow(-2), liters: 3000 })).status).toBe(201);
    await approvedDieselShift(b, 70);
    expect((await call("POST", "/station-tanks/readings", b.token, { tankId: b.tankId, purpose: "closing", readAt: hoursFromNow(1), liters: 2800 })).status).toBe(201);

    const { from, to } = range();
    const ra = await call("GET", `/station-tanks/reconciliation?companyId=${a.companyId}&from=${from}&to=${to}`, a.token);
    expect(ra.status, ra.text).toBe(200);
    expect(ra.body.rows).toHaveLength(1);
    expect(ra.body.rows[0]).toMatchObject({
      tankId: a.tankId, openingLiters: 10000, receivedLiters: 5000, soldLiters: 200, expectedLiters: 14800, closingLiters: 14790,
      varianceLiters: -10, variancePct: -5, toleranceLiters: 50, status: "ok", shiftsCounted: 1, deliveriesCounted: 1,
    });
    expect(ra.body.unassignedNozzles).toBe(2); // فوهتا البنزين بلا خزان

    const rb = await call("GET", `/station-tanks/reconciliation?companyId=${b.companyId}&from=${from}&to=${to}`, b.token);
    expect(rb.body.rows[0]).toMatchObject({ tankId: b.tankId, openingLiters: 3000, receivedLiters: 0, soldLiters: 70, expectedLiters: 2930, closingLiters: 2800, varianceLiters: -130, status: "breach" });

    // B لا يرى مطابقة شركة A
    const foreign = await call("GET", `/station-tanks/reconciliation?companyId=${a.companyId}&from=${from}&to=${to}`, b.token);
    expect([400, 403, 404]).toContain(foreign.status);
    expect(foreign.body?.rows).toBeUndefined();
  });

  it("drops a voided delivery from the reconciliation", async () => {
    const a = ctx.a;
    const del = await prisma.fuelDelivery.findFirstOrThrow({ where: { tenantId: a.tenantId } });
    expect((await call("POST", `/station-tanks/deliveries/${del.id}/void`, a.token, { reason: "سند مكرر" })).status).toBe(200);
    const { from, to } = range();
    const ra = await call("GET", `/station-tanks/reconciliation?companyId=${a.companyId}&from=${from}&to=${to}`, a.token);
    expect(ra.body.rows[0]).toMatchObject({ receivedLiters: 0, expectedLiters: 9800, varianceLiters: 4990, status: "breach" });
  });
});
