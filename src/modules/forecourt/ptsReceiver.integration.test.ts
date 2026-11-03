import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { ptsSignature, ptsLocalToUtc } from "./ptsReceiver.service";

/**
 * نقطة استقبال PTS-2 (/api/pts/upload) — على Postgres حقيقي وعبر HTTP الفعلي. رسالة الجهاز مُدخَل خارجي فعلاً (CLAUDE.md القاعدة 2):
 * الأجسام هنا هي أمثلة مواصفة jsonPTS R140 نفسها (ص310–331) بحقولها وأرقامها، مع استبدال PtsId بمعرّف المتحكم المسجَّل، وموقَّعة
 * كما يوقّع الجهاز (HMAC-SHA256 على الجسم الخام مع CRLF الختامي). كل ما يُفحَص بعدها — صفوف العمليات والقراءات والتنبيهات، والرد
 * وتوقيعه — من الكود نفسه. التحقق من طريقة التوقيع نفسها بمتجهَي الوثيقة (المفتاح "PTS-2").
 *
 * مستأجران تحمل شركتاهما الاسم نفسه، لكل منهما متحكم بمعرّف ومفتاح مختلفين؛ رسالة بمفتاح مستأجر لا تكتب في محطة الآخر.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `استقبال المتحكم ${stamp}`;
let server: Server;
let baseUrl = "";

interface Ctx {
  email: string;
  token: string;
  tenantId: string;
  companyId: string;
  station: string;
  nozzleId: string;
  tankId: string;
  controllerId: string;
  serial: string;
  secret: string;
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

/** طلب رفع كما يرسله الجهاز: الجسم + CRLF، الترويسات الموثقة، والتوقيع على البايتات نفسها (إن وُجد مفتاح). */
async function upload(serial: string, message: unknown, secret: string | null, opts: { signature?: string } = {}) {
  const body = Buffer.from(`${JSON.stringify(message)}\r\n`, "utf8");
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    authorization: "Basic YWRtaW46YWRtaW4=",
    "x-pts-id": serial,
    "x-pts-firmware-version-datetime": "2026-05-01T19:30:41",
    "x-pts-protocol-revision-number": "140",
    "x-pts-configuration-identifier": "fecab4ca",
  };
  const signature = opts.signature ?? (secret ? ptsSignature(secret, body) : undefined);
  if (signature) headers["x-data-signature"] = signature;
  const res = await fetch(`${baseUrl}/api/pts/upload`, { method: "POST", headers, body });
  const raw = Buffer.from(await res.arrayBuffer());
  let parsed: any = null;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { parsed = raw.toString("utf8"); }
  return { status: res.status, body: parsed, raw, signature: res.headers.get("x-data-signature") };
}

// أمثلة الوثيقة (R140) — UploadPumpTransaction ص313، UploadTankMeasurement ص316، UploadInTankDelivery ص319، UploadAlertRecord ص323،
// UploadStatus ص331 (الحقول المستعملة فقط)، UploadConfiguration ص329
const pumpTransaction = (serial: string, id = 35076, transaction = 4355) => ({
  Protocol: "jsonPTS", PtsId: serial,
  Packets: [{
    Id: id, Type: "UploadPumpTransaction",
    Data: {
      DateTime: "2026-08-25T15:07:43", Pump: 2, Nozzle: 1, FuelGradeId: 1, FuelGradeName: "Super", Tank: 1, Transaction: transaction, UserId: 36,
      Volume: 1.95, Amount: 30, Price: 15.35, TotalVolume: 62288.8, TotalAmount: 809996.58, DateTimeStart: "2026-08-25T15:07:17", TCVolume: 1.94,
      ShiftNumber: 1, FlowRate: 4, IsOffline: false, IsPaid: false, Tag: "", CustomData: "", IsTest: false, IsRemoteTag: false,
      PumpTransactionsUploaded: 11103, PumpTransactionsTotal: 11104, ConfigurationId: "f522cc01",
    },
  }],
});
const tankMeasurement = (serial: string, tank: number) => ({
  Protocol: "jsonPTS", PtsId: serial,
  Packets: [{
    Id: 124, Type: "UploadTankMeasurement",
    Data: {
      DateTime: "2019-05-19T12:45:14", Tank: tank, Status: "OK", Alarms: ["HighProduct"], ProductHeight: 2534.1, WaterHeight: 123.1, Temperature: 21.3,
      ProductVolume: 200, WaterVolume: 15, ProductUllage: 850, ProductTCVolume: 195, ProductDensity: 760.1, ProductMass: 190,
      TankMeasurementsUploaded: 712, TankMeasurementsTotal: 712, ConfigurationId: "1234ABCD",
    },
  }],
});
const inTankDelivery = (serial: string) => ({
  Protocol: "jsonPTS", PtsId: serial,
  Packets: [{
    Id: 124, Type: "UploadInTankDelivery",
    Data: {
      Tank: 1,
      StartValues: { DateTime: "2019-03-09T15:30:25", ProductHeight: 2534.1, WaterHeight: 123.1, Temperature: 21.3, ProductVolume: 2005, ProductTCVolume: 2015 },
      EndValues: { DateTime: "2019-03-09T15:32:15", ProductHeight: 2725.1, WaterHeight: 130.4, Temperature: 21.6, ProductVolume: 2514, ProductTCVolume: 2601 },
      AbsoluteValues: { ProductDensity: 758.9, ProductMass: 386.3, PumpsDispensedVolume: 25.3 },
      InTankDeliveriesUploaded: 112, InTankDeliveriesTotal: 112, ConfigurationId: "1234ABCD",
    },
  }],
});
const alertRecord = (serial: string) => ({
  Protocol: "jsonPTS", PtsId: serial,
  Packets: [{
    Id: 63609, Type: "UploadAlertRecord",
    Data: { DateTime: "2022-09-24T21:46:47", DeviceType: "PTS", DeviceNumber: 0, State: "Started", Code: 3, Name: "LowBattery", AlertRecordsUploaded: 130, AlertRecordsTotal: 130, ConfigurationId: "c8ebb368" },
  }],
});
const status = (serial: string, utcOffset: number) => ({
  Protocol: "jsonPTS", PtsId: serial,
  Packets: [{ Id: 127, Type: "UploadStatus", Data: { ConfigurationId: "fecab4ca", DateTime: "2026-08-25T15:10:00", UTCOffset: utcOffset, FirmwareDateTime: "2026-05-01T19:30:41", BatteryVoltage: 3100, CpuTemperature: 41 } }],
});
const configuration = (serial: string) => ({
  Protocol: "jsonPTS", PtsId: serial,
  Packets: [{ Id: 126, Type: "UploadConfiguration", ConfigurationId: "3751ade7", Configuration: [{ Type: "PtsNetworkSettings", Data: { IpAddress: [192, 168, 1, 117] } }] }],
});

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `pts-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `استقبال ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
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
  const nozzleId = (await prisma.stationNozzle.findFirstOrThrow({ where: { tenantId, costCenterId: station }, orderBy: { nozzleNumber: "asc" } })).id;
  const tank = await call("POST", "/station-tanks/tanks", token, { companyId: company.id, costCenterId: station, code: "T1", product: "diesel", capacityLiters: 30000, atgTankNumber: 1 });
  expect(tank.status, tank.text).toBe(201);

  const serial = `${key === "a" ? "0A" : "0B"}${String(stamp)}`.padEnd(24, "C").slice(0, 24).toUpperCase();
  const controller = await call("POST", "/forecourt/controllers", token, { companyId: company.id, costCenterId: station, deviceSerial: serial });
  expect(controller.status, controller.text).toBe(201);
  expect(controller.body.secretKeyEnc).toBeUndefined();
  // مضخة 2 فوهة 1 في الجهاز (مثال الوثيقة) ↔ أول فوهة في أثر
  expect((await call("PUT", `/forecourt/controllers/${controller.body.id}/nozzle-map`, token, { ptsPump: 2, ptsNozzle: 1, nozzleId })).status).toBe(200);
  const secret = await call("POST", `/forecourt/controllers/${controller.body.id}/secret`, token);
  expect(secret.status, secret.text).toBe(200);
  expect(secret.body.secretKey).toMatch(/^[A-Za-z0-9]{20}$/);
  expect(secret.body.settings).toMatchObject({ protocolType: "HTTPS", port: 443, uri: "api/pts/upload" });

  return { email, token, tenantId, companyId: company.id, station, nozzleId, tankId: tank.body.id, controllerId: controller.body.id, serial, secret: secret.body.secretKey };
}

describe("PTS-2 jsonPTS receiver (integration)", () => {
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
      await prisma.forecourtPumpTransaction.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.forecourtController.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tankReading.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationNozzle.updateMany({ where: { tenantId: c.tenantId }, data: { tankId: null } });
      await prisma.stationTank.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("signs exactly like the specification's own examples (secret \"PTS-2\", p.311)", () => {
    const request = '{"Protocol":"jsonPTS","PtsId":"002B00323133510F31313534","Packets":[{"Id":49004,"Type":"UploadPumpTransaction","Data":{"DateTime":"2026-05-01T18:10:22","Pump":1,"Nozzle":1,"FuelGradeId":1,"FuelGradeName":"Fuel","Tank":1,"Transaction":3,"UserId":1,"Volume":2.80,"Amount":3.44,"Price":1.23,"TotalVolume":2.80,"TotalAmount":3.44,"DateTimeStart":"2026-05-01T18:10:19","TCVolume":0,"FlowRate":56,"IsOffline":false,"IsPaid":false,"Tag":"","CustomData":"","IsTest":false,"IsRemoteTag":false,"PumpTransactionsUploaded":0,"PumpTransactionsTotal":3,"ConfigurationId":"94657ca8"}}]}\r\n';
    expect(Buffer.byteLength(request)).toBe(573); // Content-Length في المثال
    expect(ptsSignature("PTS-2", Buffer.from(request))).toBe("L2gxGuy/XsHZkxdP0Augk0kSIB8M6g8GluWyvASMd+4=");
    const response = '{"Protocol":"jsonPTS","Packets":[{"Id":49004,"Error":false,"Message":"OK"}]}';
    expect(ptsSignature("PTS-2", Buffer.from(response))).toBe("cfplYG/wSM6EE8KboZIQfr91TJ3Fz6oxljdMQZkmmjI=");
    expect(ptsLocalToUtc("2026-08-25T15:07:43", 180)?.toISOString()).toBe("2026-08-25T12:07:43.000Z");
    expect(ptsLocalToUtc("25/08/2026", 180)).toBeNull();
  });

  it("stores a signed pump transaction on the mapped nozzle, signs its reply, and ignores a resend", async () => {
    const a = ctx.a;
    const res = await upload(a.serial, pumpTransaction(a.serial), a.secret);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ Protocol: "jsonPTS", Packets: [{ Id: 35076, Type: "UploadPumpTransaction", Message: "OK" }] });
    expect(res.signature).toBe(ptsSignature(a.secret, res.raw));

    const again = await upload(a.serial, pumpTransaction(a.serial), a.secret);
    expect(again.body.Packets[0]).toMatchObject({ Id: 35076, Message: "OK" });

    const rows = await prisma.forecourtPumpTransaction.findMany({ where: { tenantId: a.tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ controllerId: a.controllerId, companyId: a.companyId, nozzleId: a.nozzleId, ptsPump: 2, ptsNozzle: 1, transactionNumber: 4355 });
    expect([Number(rows[0].volume), Number(rows[0].totalVolume), Number(rows[0].amount), rows[0].endedAt.toISOString(), rows[0].startedAt?.toISOString()])
      .toEqual([1.95, 62288.8, 30, "2026-08-25T12:07:43.000Z", "2026-08-25T12:07:17.000Z"]);

    const controller = await prisma.forecourtController.findUniqueOrThrow({ where: { id: a.controllerId } });
    expect([controller.firmwareVersion, controller.protocolRevision, controller.lastSeenAt != null]).toEqual(["2026-05-01T19:30:41", "140", true]);
  });

  it("refuses wrong, missing or other-tenant signatures and unknown controllers, writing nothing", async () => {
    const a = ctx.a;
    const b = ctx.b;
    const before = await prisma.forecourtPumpTransaction.count({ where: { tenantId: { in: [a.tenantId, b.tenantId] } } });
    const attempts = [
      await upload(a.serial, pumpTransaction(a.serial, 1, 9001), a.secret, { signature: "L2gxGuy/XsHZkxdP0Augk0kSIB8M6g8GluWyvASMd+4=" }),
      await upload(a.serial, pumpTransaction(a.serial, 2, 9002), null),
      await upload(b.serial, pumpTransaction(b.serial, 3, 9003), a.secret), // جهاز B بمفتاح A
      await upload("FFFFFFFFFFFFFFFFFFFFFFFF", pumpTransaction("FFFFFFFFFFFFFFFFFFFFFFFF", 4, 9004), a.secret),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(401);
      expect(res.signature).toBeNull();
    }
    // معرّف الترويسة يخالف معرّف الجسم
    const mismatch = await upload(a.serial, pumpTransaction(b.serial, 5, 9005), a.secret);
    expect(mismatch.status).toBe(401);
    expect(await prisma.forecourtPumpTransaction.count({ where: { tenantId: { in: [a.tenantId, b.tenantId] } } })).toBe(before);
  });

  it("writes tank measurements only to the controller's own mapped tank", async () => {
    const a = ctx.a;
    const b = ctx.b;
    expect((await upload(a.serial, tankMeasurement(a.serial, 1), a.secret)).body.Packets[0]).toMatchObject({ Message: "OK" });
    // خزان 2 غير معرَّف في محطة A: يُؤكَّد ولا يُكتب شيء
    expect((await upload(a.serial, tankMeasurement(a.serial, 2), a.secret)).body.Packets[0]).toMatchObject({ Message: "OK" });
    const readings = await prisma.tankReading.findMany({ where: { tenantId: a.tenantId } });
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ tankId: a.tankId, source: "atg", purpose: "spot" });
    expect([Number(readings[0].liters), Number(readings[0].heightMm), Number(readings[0].waterLiters), readings[0].readAt.toISOString()])
      .toEqual([200, 2534.1, 15, "2019-05-19T09:45:14.000Z"]);
    expect(await prisma.tankReading.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });

  it("records an in-tank delivery as before/after readings, and an alert once", async () => {
    const a = ctx.a;
    expect((await upload(a.serial, inTankDelivery(a.serial), a.secret)).body.Packets[0]).toMatchObject({ Message: "OK" });
    expect((await upload(a.serial, inTankDelivery(a.serial), a.secret)).body.Packets[0]).toMatchObject({ Message: "OK" });
    const delivery = await prisma.tankReading.findMany({ where: { tenantId: a.tenantId, purpose: { in: ["pre_delivery", "post_delivery"] } }, orderBy: { readAt: "asc" } });
    expect(delivery.map((r) => [r.purpose, Number(r.liters)])).toEqual([["pre_delivery", 2005], ["post_delivery", 2514]]);

    expect((await upload(a.serial, alertRecord(a.serial), a.secret)).body.Packets[0]).toMatchObject({ Id: 63609, Message: "OK" });
    expect((await upload(a.serial, alertRecord(a.serial), a.secret)).body.Packets[0]).toMatchObject({ Message: "OK" });
    const alerts = await call("GET", `/forecourt/alerts?companyId=${a.companyId}`, a.token);
    expect(alerts.body).toHaveLength(1);
    expect(alerts.body[0]).toMatchObject({ controllerId: a.controllerId, deviceType: "PTS", code: 3, name: "LowBattery", state: "Started" });
    expect((await call("GET", `/forecourt/alerts?companyId=${ctx.b.companyId}`, ctx.b.token)).body).toHaveLength(0);
  });

  it("takes the controller's UTC offset from its status, and accepts the unsigned configuration upload only", async () => {
    const b = ctx.b;
    expect((await upload(b.serial, status(b.serial, 120), b.secret)).body.Packets[0]).toMatchObject({ Id: 127, Message: "OK" });
    expect((await prisma.forecourtController.findUniqueOrThrow({ where: { id: b.controllerId } })).utcOffsetMinutes).toBe(120);
    await upload(b.serial, pumpTransaction(b.serial), b.secret);
    const row = await prisma.forecourtPumpTransaction.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    expect(row.endedAt.toISOString()).toBe("2026-08-25T13:07:43.000Z");

    const config = await upload(b.serial, configuration(b.serial), null);
    expect(config.status).toBe(200);
    expect(config.body.Packets[0]).toMatchObject({ Id: 126, Type: "UploadConfiguration", Message: "OK" });
    const stored = await prisma.forecourtController.findUniqueOrThrow({ where: { id: b.controllerId } });
    expect(stored.configurationId).toBe("3751ade7");

    const list = await call("GET", `/forecourt/controllers?companyId=${b.companyId}`, b.token);
    expect(list.body[0]).toMatchObject({ id: b.controllerId, hasSecret: true, hasConfiguration: true, health: "online" });
    expect(list.body[0].secretKeyEnc).toBeUndefined();
    expect(list.body[0].lastConfiguration).toBeUndefined();
  });

  it("answers an unsupported packet type with a packet error, and rotating the key invalidates the old one", async () => {
    const a = ctx.a;
    const gps = await upload(a.serial, { Protocol: "jsonPTS", PtsId: a.serial, Packets: [{ Id: 125, Type: "UploadGpsRecord", Data: {} }] }, a.secret);
    expect(gps.body.Packets[0]).toMatchObject({ Id: 125, Error: true, Code: 1, Message: "JSONPTS_ERROR_NOT_FOUND" });

    const rotated = await call("POST", `/forecourt/controllers/${a.controllerId}/secret`, a.token);
    expect(rotated.status).toBe(200);
    expect((await upload(a.serial, status(a.serial, 180), a.secret)).status).toBe(401);
    expect((await upload(a.serial, status(a.serial, 180), rotated.body.secretKey)).status).toBe(200);
    // مستأجر آخر لا يولّد مفتاحاً لمتحكم A
    expect([403, 404]).toContain((await call("POST", `/forecourt/controllers/${a.controllerId}/secret`, ctx.b.token)).status);
  });
});
