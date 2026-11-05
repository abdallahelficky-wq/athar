import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import type { ForecourtController } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { decryptSecret } from "../../lib/zatca/secretBox";
import { PTS_WEBSOCKET_URI, processDevicePackets, ptsLocalToUtc, recordDeviceHeaders, type OutPacket, type Packet } from "./ptsReceiver.service";
import { verifyPtsHandshakeSignature } from "./ptsHandshake";

export { ptsHandshakeSignedTexts, verifyPtsHandshakeSignature } from "./ptsHandshake";
import { touchController } from "./forecourt.service";

/**
 * الاتصال الدائم مع PTS-2 (المواصفة R140، "COMMUNICATION TO A REMOTE SERVER USING WEBSOCKET PROTOCOL" ص302–306). الجهاز هو العميل:
 * يفتح الاتصال إلى wss://<المضيف>/api/pts/ws ويبقيه، فيستطيع أثر أن يرسل له أي طلب jsonPTS في أي وقت (PumpAuthorize، PumpStop…)
 * ويرد الجهاز على كل طلب بحزمة تحمل نفس رقمها. إن أُرسلت أنواع الرفع (Upload…) عبر هذا الاتصال تُعالَج بنفس معالجة طلبات HTTP.
 *
 * المصادقة على المصافحة فقط (لا توقيع لكل رسالة بعدها): الجهاز يضيف X-DateTime ثم X-Data-Signature = Base64(HMAC-SHA256(المفتاح،
 * كل ما يسبق ترويسة التوقيع)) — أي سطر الطلب وكل الترويسات قبلها، كل سطر منتهٍ بـCRLF. تحقّقنا بمثال الوثيقة (ص305، المفتاح "PTS-2").
 * مصافحة بلا توقيع صحيح، أو لمتحكم غير معروف/موقوف/بلا مفتاح، أو بوقت بعيد عن الآن، تُرفض بـ401 كما تنص الوثيقة.
 *
 * الطبقات الوسيطة (Cloudflare ثم Railway) قد تضيف ترويسات أو تغيّر حالة أحرف أسمائها قبل وصولها للخادم، فيتغيّر النص الموقَّع؛
 * لذلك يُجرَّب النص كما وصل، ثم نفس ترويسات الجهاز فقط بأسمائها الموثقة. التوقيع يبقى إلزامياً في كل الحالات.
 *
 * حالة "متصل" في ذاكرة هذا الخادم: الأوامر تصل للجهاز فقط من نسخة الخادم التي يتصل بها. أثر يعمل بنسخة واحدة؛ إن صار أكثر يلزم
 * توجيه الأوامر للنسخة المتصلة (طابور مشترك).
 */

const PATH = `/${PTS_WEBSOCKET_URI}`;
const SERIAL = /^[0-9A-Fa-f]{24}$/;
/** أقصى فرق مقبول بين X-DateTime في المصافحة والآن — يمنع إعادة استعمال مصافحة ملتقطة */
const HANDSHAKE_MAX_SKEW_MS = 15 * 60_000;
export const PTS_REQUEST_TIMEOUT_MS = 10_000;

type Pending = { resolve: (packet: OutPacket & { Data?: unknown }) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };
interface Connection {
  controllerId: string;
  ws: WebSocket;
  pending: Map<number, Pending>;
  nextId: number;
  connectedAt: Date;
}

const connections = new Map<string, Connection>();

export class PtsOfflineError extends Error {}
export class PtsTimeoutError extends Error {}

export function isControllerConnected(controllerId: string) {
  const c = connections.get(controllerId);
  return Boolean(c && c.ws.readyState === c.ws.OPEN);
}

export function connectedSince(controllerId: string): Date | null {
  return isControllerConnected(controllerId) ? connections.get(controllerId)!.connectedAt : null;
}

/**
 * يرسل طلب jsonPTS واحداً للمتحكم المتصل وينتظر حزمة الرد بنفس الرقم (تأكيد، أو بيانات، أو خطأ). يرمي PtsOfflineError إن لم يكن
 * متصلاً أو انقطع قبل الرد، وPtsTimeoutError إن لم يرد خلال المهلة.
 */
export function sendPtsRequest(controllerId: string, type: string, data: Record<string, unknown>, timeoutMs = PTS_REQUEST_TIMEOUT_MS) {
  const conn = connections.get(controllerId);
  if (!conn || conn.ws.readyState !== conn.ws.OPEN) return Promise.reject(new PtsOfflineError("offline"));
  let id = conn.nextId;
  for (let tries = 0; conn.pending.has(id) && tries < 65535; tries += 1) id = (id % 65535) + 1;
  conn.nextId = (id % 65535) + 1;
  return new Promise<OutPacket & { Data?: unknown }>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      reject(new PtsTimeoutError("timeout"));
    }, timeoutMs);
    conn.pending.set(id, { resolve, reject, timer });
    conn.ws.send(JSON.stringify({ Protocol: "jsonPTS", Packets: [{ Id: id, Type: type, Data: data }] }), (err) => {
      if (!err) return;
      clearTimeout(timer);
      conn.pending.delete(id);
      reject(new PtsOfflineError("send failed"));
    });
  });
}

const isDeviceInitiated = (type: unknown) => typeof type === "string" && (type.startsWith("Upload") || type === "RequestTagsInformation");

function reject401(socket: Duplex) {
  socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}

type AuthResult = { controller: ForecourtController } | { controller?: undefined; error: string; ptsId?: string };

async function authenticate(req: IncomingMessage): Promise<AuthResult> {
  const ptsId = String(req.headers["x-pts-id"] ?? "").trim().toUpperCase();
  if (!SERIAL.test(ptsId)) return { error: "bad_id" };
  const controller = await prisma.forecourtController.findFirst({ where: { deviceSerial: ptsId } });
  if (!controller || !controller.isActive || !controller.secretKeyEnc) return { error: "unknown_controller", ptsId };
  const requestLine = `${req.method} ${req.url} HTTP/${req.httpVersion}`;
  if (!verifyPtsHandshakeSignature(decryptSecret(controller.secretKeyEnc), requestLine, req.rawHeaders)) return { error: "bad_signature", ptsId };
  const at = ptsLocalToUtc(String(req.headers["x-datetime"] ?? ""), controller.utcOffsetMinutes);
  if (!at || Math.abs(Date.now() - at.getTime()) > HANDSHAKE_MAX_SKEW_MS) return { error: "stale_datetime", ptsId };
  return { controller };
}

async function onMessage(conn: Connection, controller: ForecourtController, raw: RawData) {
  let message: { Packets?: unknown };
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const packets = Array.isArray(message?.Packets) ? (message.Packets as (Packet & { Error?: unknown; Message?: unknown; Code?: unknown })[]) : [];
  const uploads: Packet[] = [];
  for (const p of packets) {
    if (isDeviceInitiated(p?.Type)) {
      uploads.push(p);
      continue;
    }
    const id = typeof p?.Id === "number" ? p.Id : -1;
    const waiting = conn.pending.get(id);
    if (!waiting) continue;
    clearTimeout(waiting.timer);
    conn.pending.delete(id);
    waiting.resolve(p as OutPacket & { Data?: unknown });
  }
  if (uploads.length) {
    const { out } = await processDevicePackets(controller, uploads);
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify({ Protocol: "jsonPTS", Packets: out }));
  } else if (packets.length) {
    await touchController(controller.id);
  }
}

function register(controller: ForecourtController, ws: WebSocket, req: IncomingMessage) {
  const previous = connections.get(controller.id);
  if (previous && previous.ws !== ws) previous.ws.terminate();
  const conn: Connection = { controllerId: controller.id, ws, pending: new Map(), nextId: 1, connectedAt: new Date() };
  connections.set(controller.id, conn);
  const header = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  void prisma.forecourtController.update({ where: { id: controller.id }, data: { wsConnectedAt: conn.connectedAt, lastSeenAt: conn.connectedAt } }).catch(() => undefined);
  void recordDeviceHeaders(controller.id, header).catch(() => undefined);

  ws.on("message", (raw) => {
    onMessage(conn, controller, raw).catch((err) => console.error("[pts-ws] فشل معالجة رسالة", { controllerId: controller.id, err }));
  });
  // الجهاز يرسل Ping دورياً (WebsocketsPingRequestsPeriodSeconds) ومكتبة ws ترد بـPong تلقائياً — يُحدَّث آخر ظهور به
  ws.on("ping", () => {
    void touchController(controller.id).catch(() => undefined);
  });
  ws.on("close", () => {
    for (const p of conn.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new PtsOfflineError("closed"));
    }
    conn.pending.clear();
    if (connections.get(controller.id) === conn) {
      connections.delete(controller.id);
      void prisma.forecourtController.update({ where: { id: controller.id }, data: { wsDisconnectedAt: new Date() } }).catch(() => undefined);
    }
  });
  ws.on("error", () => undefined);
}

/** يربط مسار /api/pts/ws بخادم HTTP — يُستدعى مرة واحدة بعد app.listen (وفي الاختبارات على خادمها). */
export function attachPtsWebsocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== PATH) {
      socket.destroy();
      return;
    }
    authenticate(req)
      .then((result) => {
        const controller = result.controller;
        if (!controller) {
          console.warn("[pts-ws] رُفضت مصافحة", { reason: "error" in result ? result.error : undefined, ptsId: "ptsId" in result ? result.ptsId : undefined });
          reject401(socket);
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => register(controller, ws, req));
      })
      .catch((err) => {
        console.error("[pts-ws] فشل التحقق من المصافحة", err);
        reject401(socket);
      });
  });
  return wss;
}

/** للاختبارات: يغلق كل الاتصالات المفتوحة. */
export function closeAllPtsConnections() {
  for (const c of connections.values()) c.ws.terminate();
  connections.clear();
}
