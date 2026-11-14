import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import * as shifts from "../stationShifts/stationShifts.service";
import { ingestPumpTransactions, ingestTankMeasurements, controllerHealth, type ParsedPumpTransaction } from "./forecourt.service";

/**
 * متحكمات المحطات — على Postgres حقيقي وعبر مسارات HTTP الفعلية (/forecourt، /station-tanks، /station-shifts). سجلات الجهاز
 * مُدخَل خارجي (CLAUDE.md القاعدة 2): تُبنى هنا بالحقول التي يوثّقها الدليل التقني لـPTS-2 (ص110–112) وتمرّ بدوال الاستقبال
 * الحقيقية (تحت محلّل jsonPTS الذي يُبنى لاحقاً). كل ما يُفحَص بعدها — صفوف العمليات، قراءات الخزان، قراءة المتحكم في
 * الوردية — من الكود نفسه.
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بأرقام عدادات مختلفة؛ جهاز مستأجر لا يكتب في محطة الآخر.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `متحكمات ${stamp}`;
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
  nozzles: { id: string; pumpNumber: number; nozzleNumber: number }[];
  controllerId: string;
  serial: string;
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

const serialFor = (key: string) => `${key === "a" ? "00AA" : "00BB"}${String(stamp).padStart(20, "0")}`.slice(0, 24).toUpperCase();

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `fc-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `متحكمات ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const token = r.accessToken;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "المحطة 1" } })).id;
  const pump = await call("POST", "/station-setup/pumps", token, {
    companyId: company.id, costCenterId: station, pumpType: "diesel", meterType: "electronic", hasMoneyMeter: false,
    nozzles: [{ meterDigits: 7, initialReading: 1000 }, { meterDigits: 7, initialReading: 2000 }],
  });
  expect(pump.status, pump.text).toBe(201);
  const employeeId = (await prisma.stationUser.create({
    data: { tenantId, companyId: company.id, name: "عامل المحطة", role: "worker", costCenterId: station, active: true },
  })).id;
  const nozzles = await prisma.stationNozzle.findMany({ where: { tenantId, costCenterId: station }, orderBy: { nozzleNumber: "asc" }, select: { id: true, pumpNumber: true, nozzleNumber: true } });
  return { email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, nozzles, controllerId: "", serial: serialFor(key) };
}

const tx = (pump: number, nozzle: number, n: number, minutesAgo: number, volume: number, totalVolume: number): ParsedPumpTransaction => ({
  pump, nozzle, transactionNumber: n, endedAt: new Date(Date.now() - minutesAgo * 60_000), volume, totalVolume, price: 2.3, amount: Number((volume * 2.3).toFixed(2)),
});

describe("forecourt controllers: registration, nozzle links, parsed ingestion and shift comparison (integration)", () => {
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
      await prisma.forecourtController.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationShift.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tankReading.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationNozzle.updateMany({ where: { tenantId: c.tenantId }, data: { tankId: null } });
      await prisma.stationTank.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("registers one controller per station with a valid, platform-unique board ID", async () => {
    const a = ctx.a;
    const bad = await call("POST", "/forecourt/controllers", a.token, { companyId: a.companyId, costCenterId: a.station, deviceSerial: "not-hex" }, "en");
    expect(bad.status, bad.text).toBe(400);
    expect(bad.body.error).toBe("The controller board ID must be 24 hexadecimal characters (from the device information page)");

    for (const key of ["a", "b"] as const) {
      const c = ctx[key];
      const res = await call("POST", "/forecourt/controllers", c.token, { companyId: c.companyId, costCenterId: c.station, deviceSerial: c.serial.toLowerCase(), name: "PTS-2" });
      expect(res.status, res.text).toBe(201);
      expect(res.body.deviceSerial).toBe(c.serial);
      c.controllerId = res.body.id;
    }
    // نفس المحطة مرة ثانية، ونفس الجهاز من المستأجر الآخر — مرفوضان
    expect((await call("POST", "/forecourt/controllers", a.token, { companyId: a.companyId, costCenterId: a.station, deviceSerial: "AB".repeat(12) })).status).toBe(400);
    const otherStation = (await prisma.costCenter.create({ data: { tenantId: ctx.b.tenantId, companyId: ctx.b.companyId, name: "محطة 2" } })).id;
    const stolen = await call("POST", "/forecourt/controllers", ctx.b.token, { companyId: ctx.b.companyId, costCenterId: otherStation, deviceSerial: a.serial }, "en");
    expect(stolen.status).toBe(400);
    expect(stolen.body.error).toBe("This controller is already registered");

    const list = await call("GET", `/forecourt/controllers?companyId=${a.companyId}`, a.token);
    expect(list.body.map((c: { id: string; health: string }) => [c.id, c.health])).toEqual([[a.controllerId, "never_seen"]]);
  });

  it("links controller pump/nozzle numbers only to nozzles at the controller's own station", async () => {
    const a = ctx.a;
    const foreign = await call("PUT", `/forecourt/controllers/${a.controllerId}/nozzle-map`, a.token, { ptsPump: 1, ptsNozzle: 1, nozzleId: ctx.b.nozzles[0].id }, "en");
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe("The nozzle isn't at this controller's station");
    expect((await call("PUT", `/forecourt/controllers/${a.controllerId}/nozzle-map`, ctx.b.token, { ptsPump: 1, ptsNozzle: 1, nozzleId: ctx.b.nozzles[0].id })).status).toBe(404);
  });

  it("stores parsed sales idempotently, back-fills nozzles when linked later, and shows the controller reading on the shift", async () => {
    const a = ctx.a;
    // عمليتان على فوهة غير مربوطة بعد، ثم إعادة إرسال نفس الدفعة (إعادة الرفع موثّقة في الدليل)
    const batch = [tx(3, 1, 101, 30, 40, 5040), tx(3, 1, 102, 20, 60, 5100)];
    expect(await ingestPumpTransactions(a.controllerId, batch)).toEqual({ received: 2, inserted: 2 });
    expect(await ingestPumpTransactions(a.controllerId, batch)).toEqual({ received: 2, inserted: 0 });
    expect(await prisma.forecourtPumpTransaction.count({ where: { controllerId: a.controllerId, nozzleId: null } })).toBe(2);

    const map = await call("PUT", `/forecourt/controllers/${a.controllerId}/nozzle-map`, a.token, { ptsPump: 3, ptsNozzle: 1, nozzleId: a.nozzles[0].id });
    expect(map.status, map.text).toBe(200);
    expect(await prisma.forecourtPumpTransaction.count({ where: { controllerId: a.controllerId, nozzleId: a.nozzles[0].id } })).toBe(2);
    expect(controllerHealth((await prisma.forecourtController.findUniqueOrThrow({ where: { id: a.controllerId } })))).toBe("online");

    // B: نفس أرقام المضخة/الفوهة بعدادات مختلفة — لا تختلط
    expect((await call("PUT", `/forecourt/controllers/${ctx.b.controllerId}/nozzle-map`, ctx.b.token, { ptsPump: 3, ptsNozzle: 1, nozzleId: ctx.b.nozzles[0].id })).status).toBe(200);
    await ingestPumpTransactions(ctx.b.controllerId, [tx(3, 1, 101, 25, 7, 777)]);

    // وردية حقيقية لـA تُغلَق الآن: قراءة المتحكم = العداد التراكمي في آخر عملية قبل الإغلاق (5100)
    const shift = await prisma.stationShift.create({
      data: { tenantId: a.tenantId, companyId: a.companyId, costCenterId: a.station, stationUserId: a.employeeId, shiftDate: new Date(`${riyadhCalendarDay(new Date())}T00:00:00.000Z`), shiftType: "morning", openedAt: new Date(), status: "open" },
    });
    for (const n of a.nozzles) await shifts.submitReading(a.tenantId, a.employeeId, shift.id, { nozzleId: n.id, capturedAt: new Date() });
    await shifts.updateCollections(a.tenantId, a.employeeId, shift.id, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 0 });
    await shifts.submitShift(a.tenantId, a.employeeId, shift.id);
    // عملية بعد إغلاق الوردية لا تدخل قراءتها
    await ingestPumpTransactions(a.controllerId, [{ ...tx(3, 1, 103, 0, 5, 5105), endedAt: new Date(Date.now() + 60_000) }]);

    const detail = await call("GET", `/station-shifts/${shift.id}`, a.token);
    expect(detail.status, detail.text).toBe(200);
    const byNozzle = new Map(detail.body.readings.map((r: { id: string; nozzleId: string }) => [r.nozzleId, r.id]));
    const values = new Map(detail.body.controllerValues.map((v: { readingId: string; controllerValue: number | null }) => [v.readingId, v.controllerValue]));
    expect(values.get(byNozzle.get(a.nozzles[0].id))).toBe(5100);
    expect(values.get(byNozzle.get(a.nozzles[1].id))).toBeNull();
  });

  it("writes tank measurements as automatic-gauge readings only on the controller station's numbered tanks", async () => {
    const a = ctx.a;
    const tank = await call("POST", "/station-tanks/tanks", a.token, { companyId: a.companyId, costCenterId: a.station, code: "T1", product: "diesel", capacityLiters: 20000, atgTankNumber: 1 });
    expect(tank.status, tank.text).toBe(201);
    const at = new Date(Date.now() - 5 * 60_000);
    const measurement = { tank: 1, measuredAt: at, productVolume: 12345.6, productHeightMm: 1500, waterHeightMm: 3, temperatureC: 31.5 };
    expect(await ingestTankMeasurements(a.controllerId, [measurement, { ...measurement, tank: 9 }])).toEqual({ received: 2, inserted: 1, unmapped: 1 });
    expect(await ingestTankMeasurements(a.controllerId, [measurement])).toEqual({ received: 1, inserted: 0, unmapped: 0 });
    const reading = await prisma.tankReading.findFirstOrThrow({ where: { tankId: tank.body.id } });
    expect([reading.source, Number(reading.liters), Number(reading.waterHeightMm), reading.deviceId]).toEqual(["atg", 12345.6, 3, a.controllerId]);
    // جهاز B برقم الخزان نفسه لا يكتب في خزان A
    expect(await ingestTankMeasurements(ctx.b.controllerId, [measurement])).toEqual({ received: 1, inserted: 0, unmapped: 1 });
    expect(await prisma.tankReading.count({ where: { tankId: tank.body.id } })).toBe(1);
  });
});
