import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { connect } from "net";
import { randomBytes } from "crypto";
import { WebSocket } from "ws";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { ptsSignature } from "./ptsReceiver.service";
import { attachPtsWebsocket, closeAllPtsConnections } from "./ptsWebsocket";

/**
 * الاتصال الدائم مع PTS-2 (/api/pts/ws) وأوامر المضخات — على Postgres حقيقي وعبر HTTP/WebSocket الفعليين.
 *
 * الجهاز مُحاكى: مصافحته وردوده مُدخَل خارجي فعلاً (CLAUDE.md القاعدة 2). المصافحة تُكتب بايتاً بايتاً على مقبس TCP كما في مثال
 * الوثيقة (R140 ص305: نفس الترويسات وترتيبها، X-DateTime ثم X-Data-Signature على كل ما سبقها)، ثم يكمل نفس المقبس كعميل WebSocket.
 * ردود الجهاز هي أمثلة الوثيقة (PumpAuthorizeConfirmation ص190، رسالة الخطأ ص26، UploadPumpTransaction ص313). أما ما يُفحَص —
 * الطلب الذي وصل للجهاز، وصف الأمر وحالته، وحالة الاتصال، والعملية المخزّنة — فمن الكود نفسه عبر الـAPI.
 *
 * مستأجران تحمل شركتاهما الاسم نفسه: مستخدم أحدهما لا يأمر متحكم الآخر، ومتحكم الآخر غير المتصل يُسجَّل أمره "غير متصل".
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `اتصال المتحكم ${stamp}`;
let server: Server;
let port = 0;
let baseUrl = "";

interface Ctx { email: string; token: string; tenantId: string; companyId: string; controllerId: string; serial: string; secret: string; userId: string }
const ctx: Record<"a" | "b", Ctx> = {} as never;

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "accept-language": "ar" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

/** وقت الجهاز المحلي (الرياض +03:00) بصيغة الوثيقة YYYY-MM-DDThh:mm:ss */
const deviceNow = (shiftMinutes = 0) => new Date(Date.now() + (180 + shiftMinutes) * 60_000).toISOString().slice(0, 19);

interface Device { status: string; ws?: WebSocket; received: any[] }

/**
 * يفتح الاتصال كما يفتحه الجهاز: سطر الطلب وترويسات مثال الوثيقة بترتيبها، والتوقيع على كل ما يسبق ترويسته. respond يحدد رد الجهاز
 * على كل طلب يصله من أثر (null = لا يرد).
 */
function connectDevice(serial: string, secret: string, opts: { dateTime?: string; signature?: string; respond?: (p: any) => any } = {}): Promise<Device> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1");
    const received: any[] = [];
    sock.once("connect", () => {
      const lines = [
        "GET /api/pts/ws HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Authorization: Basic YWRtaW46YWRtaW4=",
        "Origin: https://192.168.1.117:443",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
        `X-Pts-Id: ${serial}`,
        "X-Pts-Firmware-Version-DateTime: 2026-08-15T17:14:15",
        "X-Pts-Configuration-Identifier: da86bd9f",
        "X-Pts-Protocol-Revision-Number: 140",
        "Sec-WebSocket-Version: 13",
        `X-DateTime: ${opts.dateTime ?? deviceNow()}`,
      ];
      const signed = lines.map((l) => `${l}\r\n`).join("");
      sock.write(`${signed}X-Data-Signature: ${opts.signature ?? ptsSignature(secret, Buffer.from(signed))}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      sock.removeListener("data", onData);
      const status = buf.subarray(0, end).toString().split("\r\n")[0];
      if (!status.includes(" 101 ")) {
        sock.destroy();
        resolve({ status, received });
        return;
      }
      // نفس المقبس يكمل كعميل WebSocket (يُقنِّع إطاراته كما يجب على العميل)
      const ws = new WebSocket(null as never, undefined, {});
      (ws as any)._isServer = false;
      (ws as any).setSocket(sock, buf.subarray(end + 4), { maxPayload: 1024 * 1024, skipUTF8Validation: false });
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        for (const p of msg.Packets ?? []) {
          received.push(p);
          const reply = opts.respond?.(p);
          if (reply) ws.send(JSON.stringify({ Protocol: "jsonPTS", Packets: [reply] }));
        }
      });
      resolve({ status, ws, received });
    };
    sock.on("data", onData);
    sock.once("error", reject);
  });
}

/** ردود الجهاز من أمثلة الوثيقة */
const deviceReplies = (p: any) => {
  if (p.Type === "PumpAuthorize") return { Id: p.Id, Type: "PumpAuthorizeConfirmation", Data: { Pump: p.Data.Pump, Transaction: 31 } };
  if (p.Type === "PumpStop") return { Id: p.Id, Type: "PumpStop", Error: true, Code: 40, Message: "JSONPTS_ERROR_BUSY_OTHER_USER", Data: { Pump: p.Data.Pump, User: "admin" } };
  if (p.Type === "PumpEmergencyStop") return { Id: p.Id, Type: "PumpEmergencyStop", Message: "OK" };
  return null;
};

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000) {
  const until = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    v = await fn();
  }
  return v;
}

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `ptsws-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `اتصال ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const token = r.accessToken;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "المحطة 1" } })).id;
  const serial = `${key === "a" ? "1A" : "1B"}${String(stamp)}`.padEnd(24, "D").slice(0, 24).toUpperCase();
  const controller = await call("POST", "/forecourt/controllers", token, { companyId: company.id, costCenterId: station, deviceSerial: serial });
  expect(controller.status, controller.text).toBe(201);
  const secret = await call("POST", `/forecourt/controllers/${controller.body.id}/secret`, token);
  expect(secret.status, secret.text).toBe(200);
  expect(secret.body.settings.websockets).toEqual({ enabled: true, uri: "api/pts/ws", port: 443, pingPeriodSeconds: 30, uploadStatus: true, statusPeriodSeconds: 3 });
  const user = await prisma.user.findFirstOrThrow({ where: { tenantId } });
  return { email, token, tenantId, companyId: company.id, controllerId: controller.body.id, serial, secret: secret.body.secretKey, userId: user.id };
}

describe("PTS-2 WebSocket remote pump control (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    attachPtsWebsocket(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
    ctx.a = await setupTenant("a");
    ctx.b = await setupTenant("b");
  }, 180_000);

  afterAll(async () => {
    closeAllPtsConnections();
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.forecourtPumpTransaction.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.forecourtController.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("refuses a handshake with a wrong signature, another controller's key, an unknown board, or a stale clock (401)", async () => {
    const a = ctx.a;
    expect((await connectDevice(a.serial, a.secret, { signature: "AAAA" })).status).toContain(" 401 ");
    expect((await connectDevice(a.serial, ctx.b.secret)).status).toContain(" 401 ");
    expect((await connectDevice("FFFFFFFFFFFFFFFFFFFFFFFF", a.secret)).status).toContain(" 401 ");
    expect((await connectDevice(a.serial, a.secret, { dateTime: deviceNow(-60) })).status).toContain(" 401 ");
    const list = await call("GET", `/forecourt/controllers?companyId=${a.companyId}`, a.token);
    expect(list.body.find((c: any) => c.id === a.controllerId).online).toBe(false);
  });

  it("authorizes a pump over the live connection and records who sent it and the device's transaction number", async () => {
    const a = ctx.a;
    const device = await connectDevice(a.serial, a.secret, { respond: deviceReplies });
    expect(device.status).toContain(" 101 ");
    const list = await waitFor(() => call("GET", `/forecourt/controllers?companyId=${a.companyId}`, a.token), (r) => {
      const c = r.body.find((x: any) => x.id === a.controllerId);
      return c?.online === true && Boolean(c.wsConnectedAt) && c.protocolRevision === "140";
    });
    const row = list.body.find((c: any) => c.id === a.controllerId);
    expect(row.online).toBe(true);
    expect(row.wsConnectedAt).toBeTruthy();
    expect(row.protocolRevision).toBe("140");

    const res = await call("POST", `/forecourt/controllers/${a.controllerId}/pump-authorize`, a.token, { companyId: a.companyId, ptsPump: 2, ptsNozzle: 1, presetType: "Amount", dose: 50 });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ type: "pump_authorize", status: "confirmed", transactionNumber: 31, ptsPump: 2, ptsNozzle: 1, presetType: "Amount", requestedById: a.userId });

    const sent = device.received.find((p) => p.Type === "PumpAuthorize");
    expect(sent.Data).toEqual({ Pump: 2, Nozzle: 1, Type: "Amount", Dose: 50, AutoCloseTransaction: false, CustomData: `athar:${res.body.id}` });

    const full = await call("POST", `/forecourt/controllers/${a.controllerId}/pump-authorize`, a.token, { companyId: a.companyId, ptsPump: 3, presetType: "FullTank" });
    expect(full.body).toMatchObject({ status: "confirmed", dose: null, ptsNozzle: null });
    expect(device.received.filter((p) => p.Type === "PumpAuthorize")[1].Data).toEqual({ Pump: 3, Type: "FullTank", AutoCloseTransaction: false, CustomData: `athar:${full.body.id}` });

    const noDose = await call("POST", `/forecourt/controllers/${a.controllerId}/pump-authorize`, a.token, { companyId: a.companyId, ptsPump: 2, presetType: "Volume" });
    expect(noDose.status).toBe(400);
  });

  it("records the device's refusal of a stop, and an emergency stop of all pumps", async () => {
    const a = ctx.a;
    const stop = await call("POST", `/forecourt/controllers/${a.controllerId}/pump-stop`, a.token, { companyId: a.companyId, ptsPump: 2 });
    expect(stop.status, stop.text).toBe(200);
    expect(stop.body).toMatchObject({ type: "pump_stop", status: "rejected", errorCode: 40, errorMessage: "JSONPTS_ERROR_BUSY_OTHER_USER" });
    const all = await call("POST", `/forecourt/controllers/${a.controllerId}/pump-stop`, a.token, { companyId: a.companyId, ptsPump: 0, emergency: true });
    expect(all.body).toMatchObject({ type: "pump_emergency_stop", status: "confirmed", ptsPump: 0 });

    const log = await call("GET", `/forecourt/commands?companyId=${a.companyId}`, a.token);
    expect(log.body.map((c: any) => c.type)).toEqual(["pump_emergency_stop", "pump_stop", "pump_authorize", "pump_authorize"]);
  });

  it("accepts an upload sent over the live connection and confirms it with the same packet id", async () => {
    const a = ctx.a;
    const device = await connectDevice(a.serial, a.secret, { respond: deviceReplies });
    device.ws!.send(JSON.stringify({
      Protocol: "jsonPTS", PtsId: a.serial,
      Packets: [{
        Id: 35076, Type: "UploadPumpTransaction",
        Data: {
          DateTime: "2026-08-25T15:07:43", Pump: 2, Nozzle: 1, FuelGradeId: 1, FuelGradeName: "Super", Tank: 1, Transaction: 31, UserId: 36,
          Volume: 21.37, Amount: 50, Price: 2.34, TotalVolume: 62288.8, TotalAmount: 809996.58, DateTimeStart: "2026-08-25T15:05:17", TCVolume: 21.3,
          IsOffline: false, IsPaid: false, Tag: "", CustomData: "athar:test", IsTest: false, IsRemoteTag: false, ConfigurationId: "f522cc01",
        },
      }],
    }));
    const confirmed = await waitFor(async () => device.received.find((p) => p.Id === 35076), (p) => Boolean(p));
    expect(confirmed).toEqual({ Id: 35076, Type: "UploadPumpTransaction", Message: "OK" });
    const tx = await prisma.forecourtPumpTransaction.findFirst({ where: { tenantId: a.tenantId, controllerId: a.controllerId, transactionNumber: 31 } });
    expect(Number(tx?.volume)).toBe(21.37);
    device.ws!.terminate();
  });

  it("keeps tenants apart: another tenant cannot command this controller, and its own idle controller is recorded offline", async () => {
    const a = ctx.a;
    const b = ctx.b;
    const cross = await call("POST", `/forecourt/controllers/${a.controllerId}/pump-authorize`, b.token, { companyId: b.companyId, ptsPump: 1, presetType: "FullTank" });
    expect(cross.status).toBe(404);
    expect(await prisma.forecourtCommand.count({ where: { tenantId: b.tenantId } })).toBe(0);

    const offline = await call("POST", `/forecourt/controllers/${b.controllerId}/pump-authorize`, b.token, { companyId: b.companyId, ptsPump: 1, presetType: "Amount", dose: 20 });
    expect(offline.body).toMatchObject({ status: "offline", errorMessage: "CONTROLLER_OFFLINE" });
    // شركة المستأجر الآخر بمعرّفها: لا يظهر شيء من أوامرها (العزل بالمستأجر في الاستعلام نفسه)
    const foreign = await call("GET", `/forecourt/commands?companyId=${a.companyId}`, b.token);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
  });

  it("marks the controller disconnected when the device closes the connection", async () => {
    const a = ctx.a;
    const device = await connectDevice(a.serial, a.secret);
    await waitFor(() => call("GET", `/forecourt/controllers?companyId=${a.companyId}`, a.token), (r) => r.body.find((c: any) => c.id === a.controllerId)?.online === true);
    device.ws!.close();
    const after = await waitFor(() => call("GET", `/forecourt/controllers?companyId=${a.companyId}`, a.token), (r) => {
      const c = r.body.find((x: any) => x.id === a.controllerId);
      return c?.online === false && Boolean(c.wsDisconnectedAt);
    });
    const row = after.body.find((c: any) => c.id === a.controllerId);
    expect(row.online).toBe(false);
    expect(row.wsDisconnectedAt).toBeTruthy();
  });
});
