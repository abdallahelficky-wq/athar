import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createPurchaseInvoice } from "../purchaseInvoices/purchaseInvoices.service";
import * as shifts from "./stationShifts.service";

/**
 * حذف وردية لم تُرحَّل — على Postgres حقيقي وعبر مسار HTTP الفعلي (POST /station-shifts/:id/delete). الورديات تمرّ
 * بمسارات الخدمة الحقيقية (قراءات، إرسال، تصحيح المحاسب، اعتماد، ترحيل) — CLAUDE.md القاعدة 2؛ ما يُصنَع يدوياً هو ما
 * يصل من الخارج فقط: صفّ الوردية المفتوحة بتاريخ مختار وصفّ مرفق صورة العداد (رفع ملف).
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بمبالغ مختلفة: حذف وردية في أحدهما لا يمسّ الآخر، ولا يصل إليها المستأجر الآخر.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `حذف الورديات ${stamp}`;
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
  warehouseId: string;
  diesel: string;
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
const del = (c: Ctx, shiftId: string, reason?: string, lang = "ar") =>
  call("POST", `/station-shifts/${shiftId}/delete`, c.token, reason === undefined ? {} : { reason }, lang);

async function setupTenant(key: "a" | "b", dieselQty: number, dieselPrice: number): Promise<Ctx> {
  const email = `shift-del-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `حذف وردية ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "المحطة 1" } })).id;
  const token = r.accessToken;

  const pump = await call("POST", "/station-setup/pumps", token, {
    companyId: company.id, costCenterId: station, pumpType: "diesel", meterType: "electronic", hasMoneyMeter: false,
    nozzles: [{ meterDigits: 7, initialReading: 1000 }, { meterDigits: 7, initialReading: 2000 }],
  });
  expect(pump.status, pump.text).toBe(201);
  const price = await call("POST", "/station-setup/fuel-prices", token, { companyId: company.id, product: "diesel", priceInclVat: 2.3, effectiveFrom: "2026-01-01" });
  expect(price.status, price.text).toBe(201);

  const employeeId = (await prisma.employee.create({
    data: { tenantId, companyId: company.id, name: "عامل المحطة", hireDate: new Date("2026-01-01"), basicSalary: 3000, assignedCostCenterId: station },
  })).id;
  const item = async (code: string) => (await prisma.item.findFirstOrThrow({ where: { tenantId, companyId: company.id, code } })).id;
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { tenantId, companyId: company.id, isDefault: true } })).id;
  const c: Ctx = { email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, warehouseId, diesel: await item("0003") };

  const map = await call("PATCH", `/companies/${c.companyId}`, token, {
    stationDieselItemId: c.diesel, stationGasoline91ItemId: await item("0001"), stationGasoline95ItemId: await item("0002"),
  });
  expect(map.status, map.text).toBe(200);
  const link = await call("PUT", `/station-setup/stations/${station}/warehouse`, token, { companyId: c.companyId, warehouseId });
  expect(link.status, link.text).toBe(200);

  const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId, companyId: c.companyId } });
  await createPurchaseInvoice(tenantId, c.userId, {
    companyId: c.companyId, supplierId: supplier.id, date: day("2026-10-01"),
    lines: [{ accountId: "derived-from-item", itemId: c.diesel, warehouseId, quantity: dieselQty, unitPrice: dieselPrice }],
  } as never);
  return c;
}

/** وردية حتى "قيد المراجعة" بمسارات الخدمة الحقيقية، مع مرفق صورة لكل قراءة. */
async function reviewedShift(c: Ctx, date: string, liters: number, shiftType: "morning" | "night" = "morning") {
  const shift = await prisma.stationShift.create({
    data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.station, employeeId: c.employeeId, shiftDate: day(date), shiftType, openedAt: new Date(), status: "open" },
  });
  const nozzles = await prisma.stationNozzle.findMany({ where: { tenantId: c.tenantId, costCenterId: c.station, isActive: true }, orderBy: [{ pumpNumber: "asc" }, { nozzleNumber: "asc" }] });
  const readingIds: string[] = [];
  for (const n of nozzles) {
    const reading = await shifts.submitReading(c.tenantId, c.employeeId, shift.id, { nozzleId: n.id, capturedAt: new Date() });
    await prisma.attachment.create({ data: { tenantId: c.tenantId, entityType: "station_shift_reading", entityId: reading.id, fileName: "meter.jpg", fileKey: `test-missing-${reading.id}`, fileSize: 1, mimeType: "image/jpeg" } });
    readingIds.push(reading.id);
  }
  await shifts.updateCollections(c.tenantId, c.employeeId, shift.id, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 0 });
  await shifts.submitShift(c.tenantId, c.employeeId, shift.id);
  let remaining = liters;
  for (const id of readingIds) {
    const row = await prisma.stationShiftReading.findUniqueOrThrow({ where: { id } });
    await shifts.correctReading(c.tenantId, c.userId, shift.id, id, Number(row.openingReading) + remaining);
    remaining = 0;
  }
  return { shiftId: shift.id, readingIds };
}

describe("deleting a station shift that was never posted (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a", 5000, 1.5);
    ctx.b = await setupTenant("b", 70, 1.9);
  }, 180_000);

  afterAll(async () => {
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.stockMovement.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationShift.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationShiftAuditLog.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("requires a reason, and the other tenant cannot reach the shift", async () => {
    const { shiftId } = await reviewedShift(ctx.a, "2026-09-01", 10);
    const noReason = await del(ctx.a, shiftId, "   ");
    expect(noReason.status, noReason.text).toBe(400);
    const foreign = await del(ctx.b, shiftId, "محاولة من مستأجر آخر");
    expect(foreign.status, foreign.text).toBe(404);
    expect(await prisma.stationShift.count({ where: { id: shiftId } })).toBe(1);
    // تنظيف لحالة الاختبارات التالية (السلسلة)
    expect((await del(ctx.a, shiftId, "تنظيف")).status).toBe(200);
  });

  it("deletes a submitted shift with its readings and attachments, keeps an audit row, and leaves the other tenant's same-named company untouched", async () => {
    const a = await reviewedShift(ctx.a, "2026-09-02", 12);
    const b = await reviewedShift(ctx.b, "2026-09-02", 7);

    const res = await del(ctx.a, a.shiftId, "وردية تجريبية");
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ id: a.shiftId, deleted: true });

    expect(await prisma.stationShift.count({ where: { id: a.shiftId } })).toBe(0);
    expect(await prisma.stationShiftReading.count({ where: { shiftId: a.shiftId } })).toBe(0);
    expect(await prisma.stationShiftCollection.count({ where: { shiftId: a.shiftId } })).toBe(0);
    expect(await prisma.attachment.count({ where: { tenantId: ctx.a.tenantId, entityId: { in: a.readingIds } } })).toBe(0);
    const audit = await prisma.stationShiftAuditLog.findFirstOrThrow({ where: { tenantId: ctx.a.tenantId, shiftId: a.shiftId, action: "delete" } });
    expect([audit.userId, audit.companyId, audit.newValue]).toEqual([ctx.a.userId, ctx.a.companyId, "وردية تجريبية"]);

    // الشركة الأخرى بالاسم نفسه: ورديتها وقراءاتها ومرفقاتها كما هي
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: b.shiftId } })).status).toBe("under_review");
    expect(await prisma.stationShiftReading.count({ where: { shiftId: b.shiftId } })).toBe(2);
    expect(await prisma.attachment.count({ where: { tenantId: ctx.b.tenantId, entityId: { in: b.readingIds } } })).toBe(2);
    expect((await del(ctx.b, b.shiftId, "تنظيف")).status).toBe(200);
  });

  it("refuses to delete a shift when a newer active shift at the station depends on its readings, then allows newest-first", async () => {
    const older = await reviewedShift(ctx.a, "2026-09-03", 5, "morning");
    const newer = await reviewedShift(ctx.a, "2026-09-03", 6, "night");

    const blocked = await del(ctx.a, older.shiftId, "بالخطأ", "en");
    expect(blocked.status, blocked.text).toBe(400);
    expect(blocked.body.error).toBe("A later shift at this station relies on this shift's readings. Delete the newer shifts first");

    expect((await del(ctx.a, newer.shiftId, "بالخطأ")).status).toBe(200);
    expect((await del(ctx.a, older.shiftId, "بالخطأ")).status).toBe(200);
  });

  it("allows deleting a rejected shift, and never a posted one (its entry and fuel issue stay)", async () => {
    const rejected = await reviewedShift(ctx.a, "2026-09-04", 3);
    const rej = await call("POST", `/station-shifts/${rejected.shiftId}/reject`, ctx.a.token, { reasonCode: "تجريبية" });
    expect(rej.status, rej.text).toBe(200);
    expect((await del(ctx.a, rejected.shiftId, "مرفوضة تجريبية")).status).toBe(200);

    const { shiftId } = await reviewedShift(ctx.a, "2026-09-05", 20);
    expect((await call("POST", `/station-shifts/${shiftId}/approve`, ctx.a.token)).status).toBe(200);
    const posted = await call("POST", `/station-shifts/${shiftId}/post`, ctx.a.token);
    expect(posted.status, posted.text).toBe(200);

    const refused = await del(ctx.a, shiftId, "محاولة حذف مرحَّلة", "en");
    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.error).toBe("A posted or reversed shift can't be deleted. Use Reverse shift instead");
    const still = await prisma.stationShift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(still.status).toBe("posted");
    expect(await prisma.journalEntry.count({ where: { id: still.journalEntryId! } })).toBe(1);
    expect(await prisma.stockMovement.count({ where: { tenantId: ctx.a.tenantId, sourceStationShiftId: shiftId } })).toBe(1);
  });
});
