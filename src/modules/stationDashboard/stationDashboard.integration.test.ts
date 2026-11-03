import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import * as shifts from "../stationShifts/stationShifts.service";
import { ptsSignature } from "../forecourt/ptsReceiver.service";

/**
 * لوحة المحطات — على Postgres حقيقي وعبر HTTP. كل رقم تعرضه اللوحة يأتي من مخرجات النظام (CLAUDE.md القاعدة 2): ورديات تمرّ بالخدمة
 * (قراءات، تحصيل، إرسال، تصحيح المحاسب) واعتماد عبر HTTP، قراءة خزان عبر /station-tanks، ورسالة بيع من المتحكم عبر /api/pts/upload
 * موقَّعة كما يوقّع الجهاز (مثال مواصفة jsonPTS). المصنوع يدوياً: صفّ الوردية المفتوحة (فتح العامل بتاريخ اليوم دائماً)، ووردية ثانية
 * تُترك "قيد الإرسال" لتظهر عدداً معلّقاً لا رقماً.
 *
 * مستأجران تحمل شركتاهما الاسم نفسه: A يبيع 100 لتر ديزل بسعر 2.30، وB يبيع 40 لتراً — أي خلط يظهر في الأرقام فوراً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `لوحة المحطات ${stamp}`;
const TODAY = riyadhCalendarDay(new Date());
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

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `sdash-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `لوحة ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
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
  expect((await call("POST", "/station-setup/fuel-prices", token, { companyId: company.id, product: "diesel", priceInclVat: 2.3, effectiveFrom: "2026-01-01" })).status).toBe(201);
  const employeeId = (await prisma.employee.create({
    data: { tenantId, companyId: company.id, name: "عامل المحطة", hireDate: new Date("2026-01-01"), basicSalary: 3000, assignedCostCenterId: station },
  })).id;
  const nozzles = (await prisma.stationNozzle.findMany({ where: { tenantId, costCenterId: station }, orderBy: { nozzleNumber: "asc" } })).map((n) => n.id);
  const tank = await call("POST", "/station-tanks/tanks", token, { companyId: company.id, costCenterId: station, code: "T1", product: "diesel", capacityLiters: 20000, atgTankNumber: 1 });
  expect(tank.status, tank.text).toBe(201);
  for (const n of nozzles) expect((await call("PUT", `/station-tanks/nozzles/${n}/tank`, token, { tankId: tank.body.id })).status).toBe(200);
  return { email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, nozzles, tankId: tank.body.id };
}

/** وردية مُعتمَدة عبر الخدمة وHTTP — كل اللترات على أول فوهة، والتحصيل: شبكة network والباقي نقداً. */
async function approvedShift(c: Ctx, liters: number, network: number) {
  const shift = await prisma.stationShift.create({
    data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.station, employeeId: c.employeeId, shiftDate: new Date(`${TODAY}T00:00:00.000Z`), shiftType: "morning", openedAt: new Date(), status: "open" },
  });
  const readingIds: { id: string; nozzleId: string }[] = [];
  for (const nozzleId of c.nozzles) {
    const reading = await shifts.submitReading(c.tenantId, c.employeeId, shift.id, { nozzleId, capturedAt: new Date() });
    await prisma.attachment.create({ data: { tenantId: c.tenantId, entityType: "station_shift_reading", entityId: reading.id, fileName: "meter.jpg", fileKey: `k-${reading.id}`, fileSize: 1, mimeType: "image/jpeg" } });
    readingIds.push({ id: reading.id, nozzleId });
  }
  const gross = Number((liters * 2.3).toFixed(2));
  await shifts.updateCollections(c.tenantId, c.employeeId, shift.id, { networkAmount: network, fuelCardAmount: 0, cashDelivered: Number((gross - network).toFixed(2)) });
  await shifts.submitShift(c.tenantId, c.employeeId, shift.id);
  for (const r of readingIds) {
    const row = await prisma.stationShiftReading.findUniqueOrThrow({ where: { id: r.id } });
    await shifts.correctReading(c.tenantId, c.userId, shift.id, r.id, Number(row.openingReading) + (r.nozzleId === c.nozzles[0] ? liters : 0));
  }
  const approved = await call("POST", `/station-shifts/${shift.id}/approve`, c.token);
  expect(approved.status, approved.text).toBe(200);
}

describe("stations dashboard (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a");
    ctx.b = await setupTenant("b");
    await approvedShift(ctx.a, 100, 50);
    await approvedShift(ctx.b, 40, 0);
    // وردية ثانية لـA تبقى مفتوحة — تُعَدّ "للمراجعة" ولا تدخل الأرقام
    await prisma.stationShift.create({
      data: { tenantId: ctx.a.tenantId, companyId: ctx.a.companyId, costCenterId: ctx.a.station, employeeId: ctx.a.employeeId, shiftDate: new Date(`${TODAY}T00:00:00.000Z`), shiftType: "night", openedAt: new Date(), status: "open" },
    });
    // قراءة خزان لكل مستأجر: A ممتلئ 15000 من 20000، B منخفض 3000 (15%)
    expect((await call("POST", "/station-tanks/readings", ctx.a.token, { tankId: ctx.a.tankId, purpose: "spot", readAt: new Date().toISOString(), liters: 15000 })).status).toBe(201);
    expect((await call("POST", "/station-tanks/readings", ctx.b.token, { tankId: ctx.b.tankId, purpose: "spot", readAt: new Date().toISOString(), liters: 3000 })).status).toBe(201);
  }, 240_000);

  afterAll(async () => {
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.forecourtPumpTransaction.deleteMany({ where: { tenantId: c.tenantId } });
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

  it("totals each tenant's approved shifts, collections, pending shifts and tank state separately", async () => {
    const a = await call("GET", `/station-dashboard?companyId=${ctx.a.companyId}&from=${TODAY}&to=${TODAY}`, ctx.a.token);
    expect(a.status, a.text).toBe(200);
    expect(a.body.totals).toMatchObject({ liters: 100, value: 230, shifts: 1, cash: 180, network: 50, awaitingReview: 1, awaitingPost: 1, lowTanks: 0 });
    expect(a.body.totals.products.diesel).toEqual({ liters: 100, value: 230 });
    expect(a.body.stations).toHaveLength(1);
    expect(a.body.stations[0]).toMatchObject({ costCenterId: ctx.a.station, liters: 100, value: 230, controller: null, today: null });
    expect(a.body.stations[0].tanks[0]).toMatchObject({ tankId: ctx.a.tankId, liters: 15000, fillPct: 75, low: false, avgDailySold: 14.3, daysOfCover: 1049 });
    expect(a.body.daily).toEqual([{ day: TODAY, liters: 100, value: 230, [ctx.a.station]: 100 }]);

    const b = await call("GET", `/station-dashboard?companyId=${ctx.b.companyId}&from=${TODAY}&to=${TODAY}`, ctx.b.token);
    expect(b.body.totals).toMatchObject({ liters: 40, value: 92, cash: 92, network: 0, awaitingReview: 0, awaitingPost: 1, lowTanks: 1 });
    expect(b.body.stations[0].tanks[0]).toMatchObject({ liters: 3000, fillPct: 15, low: true });

    // B لا يرى لوحة شركة A ولا صفحة محطتها
    const foreign = await call("GET", `/station-dashboard?companyId=${ctx.a.companyId}&from=${TODAY}&to=${TODAY}`, ctx.b.token);
    expect([400, 403, 404]).toContain(foreign.status);
    const foreignStation = await call("GET", `/station-dashboard/stations/${ctx.a.station}?companyId=${ctx.b.companyId}&from=${TODAY}&to=${TODAY}`, ctx.b.token);
    expect(foreignStation.status).toBe(404);
  });

  it("shows today's controller sales by Riyadh hour once the station uploads them", async () => {
    const a = ctx.a;
    const serial = `0D${String(stamp)}`.padEnd(24, "E").slice(0, 24).toUpperCase();
    const controller = await call("POST", "/forecourt/controllers", a.token, { companyId: a.companyId, costCenterId: a.station, deviceSerial: serial });
    expect(controller.status, controller.text).toBe(201);
    expect((await call("PUT", `/forecourt/controllers/${controller.body.id}/nozzle-map`, a.token, { ptsPump: 2, ptsNozzle: 1, nozzleId: a.nozzles[0] })).status).toBe(200);
    const secret = (await call("POST", `/forecourt/controllers/${controller.body.id}/secret`, a.token)).body.secretKey;

    // عملية بيع اليوم الساعة 10:15 بتوقيت الرياض، بحقول مثال المواصفة (ص313)
    const message = {
      Protocol: "jsonPTS", PtsId: serial,
      Packets: [{ Id: 1, Type: "UploadPumpTransaction", Data: { DateTime: `${TODAY}T10:15:00`, DateTimeStart: `${TODAY}T10:14:30`, Pump: 2, Nozzle: 1, Transaction: 7, Volume: 25.5, Amount: 58.65, Price: 2.3, TotalVolume: 1025.5, TotalAmount: 2358.65, ConfigurationId: "f522cc01" } }],
    };
    const body = Buffer.from(`${JSON.stringify(message)}\r\n`);
    const res = await fetch(`${baseUrl}/api/pts/upload`, { method: "POST", headers: { "content-type": "application/json", "x-pts-id": serial, "x-data-signature": ptsSignature(secret, body) }, body });
    expect(res.status).toBe(200);

    const detail = await call("GET", `/station-dashboard/stations/${a.station}?companyId=${a.companyId}&from=${TODAY}&to=${TODAY}`, a.token);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.station).toMatchObject({ costCenterId: a.station, liters: 100, controller: { health: "online" } });
    expect(detail.body.station.today).toMatchObject({ liters: 25.5, amount: 58.65, count: 1 });
    expect(detail.body.station.today.hourly[10]).toEqual({ hour: 10, liters: 25.5, amount: 58.65 });
    expect(detail.body.daily).toEqual([{ day: TODAY, gasoline_91: 0, gasoline_95: 0, diesel: 100, value: 230 }]);
    expect(detail.body.tankSeries[0]).toMatchObject({ tankId: a.tankId, code: "T1" });
    expect(detail.body.tankSeries[0].points.map((p: any) => p.liters)).toEqual([15000]);
    expect(detail.body.shifts.map((s: any) => s.status).sort()).toEqual(["approved", "open"]);

    // B لم يتأثر ببيع متحكم A
    const b = await call("GET", `/station-dashboard?companyId=${ctx.b.companyId}&from=${TODAY}&to=${TODAY}`, ctx.b.token);
    expect(b.body.totals.todayLiters).toBe(0);
  });

  it("refuses an over-long period", async () => {
    const res = await call("GET", `/station-dashboard?companyId=${ctx.a.companyId}&from=2026-01-01&to=2026-12-31`, ctx.a.token);
    expect(res.status).toBe(400);
  });
});
