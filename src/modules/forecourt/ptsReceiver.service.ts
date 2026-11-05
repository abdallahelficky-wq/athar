import { randomBytes } from "crypto";
import { ptsSignature, signaturesMatch } from "./ptsHandshake";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";
import { decryptSecret, encryptSecret } from "../../lib/zatca/secretBox";
import { env } from "../../config/env";
import { ingestPumpTransactions, ingestTankMeasurements, touchController, type ParsedPumpTransaction, type ParsedTankMeasurement } from "./forecourt.service";

/**
 * نقطة استقبال رسائل متحكم Technotrade PTS-2 بروتوكول jsonPTS (المواصفة R140، "COMMUNICATION TO A REMOTE SERVER USING HTTP
 * REQUESTS" ص307–311 وطلبات الرفع ص312–335). الجهاز عميل HTTP: يرسل POST فيه {"Protocol":"jsonPTS","PtsId":…,"Packets":[…]}
 * ويعيد إرسال كل سجل حتى يتلقى تأكيداً بنفس رقم الحزمة.
 *
 * المصادقة: لكل متحكم مفتاح (SecretKey) يولّده أثر ويُدخَل في إعداد السيرفر البعيد بالجهاز. الجهاز يضيف X-Data-Signature =
 * Base64(HMAC-SHA256(المفتاح، جسم الطلب الخام كما وصل بالبايت)) — الجسم يشمل CRLF الختامي (تحقّقنا بمثال الوثيقة: Content-Length 573
 * = 571 + 2، والتوقيع يطابق فقط مع CRLF). والرد يجب أن يحمل توقيع جسمه بالضبط، وإلا يرفضه الجهاز (ص311).
 * الاستثناء الوحيد: UploadConfiguration يُرسَل بلا توقيع دائماً (ص329 ملاحظة 3) — يُقبَل بلا توقيع لأنه لقطة إعداد للعرض فقط لا يغيّر
 * شيئاً، ورسالة بلا توقيع فيها أي نوع آخر تُرفض كلها بـ401.
 *
 * الهوية: PtsId في الجسم = X-Pts-Id في الترويسة = معرّف لوحة المتحكم المسجَّل (deviceSerial). كل ما يُكتب مقيَّد بشركة ذلك المتحكم
 * ومحطته — رقم المضخة/الخزان يُحَلّ عبر ربط هذا المتحكم فقط. الإدراج بلا تكرار (إعادة الإرسال متوقعة).
 *
 * الأوقات: الجهاز يرسل وقتاً محلياً بلا منطقة (YYYY-MM-DDThh:mm:ss)؛ يُحوَّل بفرق توقيت المتحكم (utcOffsetMinutes، يُحدَّث من
 * UploadStatus.UTCOffset، الافتراضي +180 الرياض).
 */

const SERIAL = /^[0-9A-Fa-f]{24}$/;
const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const SECRET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** حدّ حقل SecretKey في الجهاز (ص73): حتى 20 حرفاً */
export const PTS_SECRET_LENGTH = 20;
/** المسار الذي يُكتب في حقول Upload…Uri بالجهاز (حتى 40 حرفاً) — يُطلَب به "/" + هذا المسار */
export const PTS_UPLOAD_URI = "api/pts/upload";
/** مسار الاتصال الدائم (WebsocketsUri بالجهاز) — منه يستقبل الجهاز أوامر أثر (تشغيل/إيقاف مضخة) */
export const PTS_WEBSOCKET_URI = "api/pts/ws";

export interface PtsHttpResult {
  status: number;
  body: Buffer;
  signature?: string;
}

export { ptsSignature, signaturesMatch } from "./ptsHandshake";
const sign = ptsSignature;

/** وقت الجهاز المحلي → UTC بفرق توقيته. null إن لم يكن بالصيغة الموثقة. */
export function ptsLocalToUtc(value: unknown, utcOffsetMinutes: number): Date | null {
  if (typeof value !== "string") return null;
  const m = LOCAL_DT.exec(value);
  if (!m) return null;
  const [, y, mo, dd, h, mi, s] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, dd, h, mi, s) - utcOffsetMinutes * 60_000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

function json(body: unknown) {
  return Buffer.from(JSON.stringify(body), "utf8");
}

export type Packet = { Id?: unknown; Type?: unknown; Data?: unknown; ConfigurationId?: unknown; Configuration?: unknown };
export type OutPacket = { Id: number; Type: string; Message?: string; Error?: boolean; Code?: number };

const ok = (id: number, type: string): OutPacket => ({ Id: id, Type: type, Message: "OK" });
const fail = (id: number, type: string, code: number, message: string): OutPacket => ({ Id: id, Type: type, Error: true, Code: code, Message: message });

/** توليد مفتاح جديد لمتحكم (يُبطل السابق) — يُعاد نصاً مرة واحدة ليُدخَل في الجهاز، ويُخزَّن مشفَّراً فقط. */
export async function rotateControllerSecret(tenantId: string, controllerId: string) {
  const c = await prisma.forecourtController.findFirst({ where: { id: controllerId, tenantId } });
  if (!c) throw notFound("المتحكم غير موجود");
  const bytes = randomBytes(PTS_SECRET_LENGTH);
  const secret = Array.from(bytes, (b) => SECRET_ALPHABET[b % SECRET_ALPHABET.length]).join("");
  await prisma.forecourtController.update({ where: { id: c.id }, data: { secretKeyEnc: encryptSecret(secret), secretKeySetAt: new Date() } });
  return { secretKey: secret, settings: connectionSettings() };
}

/** ما يُدخَل في صفحة "Remote server" بالجهاز — كل أنواع الرفع المدعومة على نفس المسار. */
export function connectionSettings() {
  return {
    domainName: env.ptsDeviceHost || null,
    protocolType: "HTTPS",
    port: 443,
    uri: PTS_UPLOAD_URI,
    uploads: ["UploadPumpTransactions", "UploadTankMeasurements", "UploadInTankDeliveries", "UploadAlertRecords", "UploadStatus", "UploadConfiguration"],
    statusPeriodSeconds: 60,
    // الأوامر من أثر للجهاز: يفعَّل UseWebsocketsCommunication ويبقى الرفع بطلبات HTTP أعلاه (خيارات Websockets Upload… مغلقة).
    // المستخدم المختار للسيرفر البعيد في الجهاز (UserId) يحتاج صلاحية Control حتى يقبل أوامر المضخات.
    websockets: { enabled: true, uri: PTS_WEBSOCKET_URI, port: 443, pingPeriodSeconds: 30 },
  };
}

async function ingestInTankDelivery(c: { id: string; tenantId: string; companyId: string; costCenterId: string; deviceSerial: string }, data: Record<string, unknown>, offset: number) {
  const tankNo = int(data.Tank);
  if (!tankNo) return { stored: 0, reason: "all_tanks_or_missing" };
  const tank = await prisma.stationTank.findFirst({ where: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.costCenterId, atgTankNumber: tankNo } });
  if (!tank) return { stored: 0, reason: "unmapped_tank" };
  let stored = 0;
  for (const [key, purpose] of [["StartValues", "pre_delivery"], ["EndValues", "post_delivery"]] as const) {
    const v = (data[key] ?? {}) as Record<string, unknown>;
    const at = ptsLocalToUtc(v.DateTime, offset);
    const liters = num(v.ProductVolume);
    if (!at || liters == null) continue;
    const created = await prisma.tankReading.createMany({
      data: [{
        tenantId: c.tenantId, companyId: c.companyId, tankId: tank.id, source: "atg", purpose, readAt: at, liters,
        heightMm: num(v.ProductHeight), waterHeightMm: num(v.WaterHeight), temperatureC: num(v.Temperature), tcLiters: num(v.ProductTCVolume),
        density: num(v.ProductDensity), massKg: num(v.ProductMass), deviceId: c.id,
        externalId: `${c.deviceSerial}:${tankNo}:delivery-${purpose}:${at.toISOString()}`, rawPayload: data as Prisma.InputJsonValue,
        note: "توريد رصده الجهاز الآلي",
      }],
      skipDuplicates: true,
    });
    stored += created.count;
  }
  return { stored };
}

/**
 * يعالج طلب رفع واحداً من الجهاز. يُرجع رمز HTTP وجسم الرد (وتوقيعه حين يكون المتحكم معروفاً وله مفتاح). لا يرمي — كل فشل يُترجم
 * لرد يفهمه الجهاز: 400 لرسالة غير صالحة، 401 لمتحكم غير معروف/موقوف/بلا مفتاح أو توقيع خاطئ (يحتفظ الجهاز بالسجلات ويعيد لاحقاً)،
 * و200 بحزم تأكيد أو خطأ لكل حزمة.
 */
export async function handlePtsUpload(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<PtsHttpResult> {
  const header = (name: string) => {
    const v = headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  let message: { Protocol?: unknown; PtsId?: unknown; Packets?: unknown };
  try {
    message = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: json({ Protocol: "jsonPTS", Error: true, Code: 2, Message: "JSONPTS_ERROR_PARSE" }) };
  }
  const packets = Array.isArray(message?.Packets) ? (message.Packets as Packet[]) : null;
  if (message?.Protocol !== "jsonPTS" || !packets) {
    return { status: 400, body: json({ Protocol: "jsonPTS", Error: true, Code: 2, Message: "JSONPTS_ERROR_PARSE" }) };
  }

  const bodyId = typeof message.PtsId === "string" ? message.PtsId : undefined;
  const headerId = header("x-pts-id");
  const ptsId = (bodyId ?? headerId ?? "").trim().toUpperCase();
  const unauthorized = (): PtsHttpResult => ({ status: 401, body: json({ Protocol: "jsonPTS", Error: true, Code: 3, Message: "JSONPTS_ERROR_UNAUTHORIZED" }) });
  if (!SERIAL.test(ptsId) || (bodyId && headerId && bodyId.trim().toUpperCase() !== headerId.trim().toUpperCase())) return unauthorized();

  const controller = await prisma.forecourtController.findFirst({ where: { deviceSerial: ptsId } });
  if (!controller || !controller.isActive || !controller.secretKeyEnc) return unauthorized();
  const secret = decryptSecret(controller.secretKeyEnc);

  const received = header("x-data-signature");
  const onlyConfiguration = packets.length > 0 && packets.every((p) => p?.Type === "UploadConfiguration");
  if (received) {
    if (!signaturesMatch(sign(secret, rawBody), received)) return unauthorized();
  } else if (!onlyConfiguration) {
    return unauthorized();
  }

  const { out } = await processDevicePackets(controller, packets);
  await recordDeviceHeaders(controller.id, header);

  const body = json({ Protocol: "jsonPTS", Packets: out });
  return { status: 200, body, signature: sign(secret, body) };
}

type DeviceController = { id: string; tenantId: string; companyId: string; costCenterId: string; deviceSerial: string; utcOffsetMinutes: number };

/** تحديث نسخة البرنامج ورقم مراجعة البروتوكول من ترويسات الجهاز (رفع HTTP أو مصافحة WebSocket). */
export async function recordDeviceHeaders(controllerId: string, header: (name: string) => string | undefined) {
  const firmware = header("x-pts-firmware-version-datetime");
  const revision = header("x-pts-protocol-revision-number");
  if (!firmware && !revision) return;
  await prisma.forecourtController.update({
    where: { id: controllerId },
    data: { ...(firmware ? { firmwareVersion: firmware } : {}), ...(revision ? { protocolRevision: revision } : {}) },
  });
}

/**
 * يعالج حزم الرفع (Upload…) من متحكم تحقّقت هويته — نفس المعالجة سواء وصلت بطلب HTTP موقَّع أو عبر اتصال WebSocket الذي تحقّق
 * توقيع مصافحته. يُرجع حزمة تأكيد أو خطأ لكل حزمة بنفس رقمها، ولا يرمي.
 */
export async function processDevicePackets(controller: DeviceController, packets: Packet[]): Promise<{ out: OutPacket[] }> {
  let offset = controller.utcOffsetMinutes;
  let status: unknown;
  const out: OutPacket[] = [];
  for (const packet of packets) {
    const id = int(packet?.Id) ?? 0;
    const type = typeof packet?.Type === "string" ? packet.Type : "";
    const data = (packet?.Data && typeof packet.Data === "object" ? packet.Data : {}) as Record<string, unknown>;
    try {
      switch (type) {
        case "UploadStatus": {
          const reported = int(data.UTCOffset);
          if (reported != null && reported >= -1440 && reported <= 1440 && reported !== offset) {
            offset = reported;
            await prisma.forecourtController.update({ where: { id: controller.id }, data: { utcOffsetMinutes: reported } });
          }
          status = data;
          out.push(ok(id, type));
          break;
        }
        case "UploadPumpTransaction": {
          const endedAt = ptsLocalToUtc(data.DateTime, offset);
          const pump = int(data.Pump);
          const nozzle = int(data.Nozzle);
          const transactionNumber = int(data.Transaction);
          const volume = num(data.Volume);
          if (!endedAt || !pump || !nozzle || !transactionNumber || volume == null) {
            out.push(fail(id, type, 4, "JSONPTS_ERROR_WRONG_DATA"));
            break;
          }
          const record: ParsedPumpTransaction = {
            pump, nozzle, transactionNumber, endedAt, volume,
            startedAt: ptsLocalToUtc(data.DateTimeStart, offset), tcVolume: num(data.TCVolume), amount: num(data.Amount), price: num(data.Price),
            totalVolume: num(data.TotalVolume), totalAmount: num(data.TotalAmount), tag: typeof data.Tag === "string" && data.Tag ? data.Tag : null, raw: data,
          };
          await ingestPumpTransactions(controller.id, [record]);
          out.push(ok(id, type));
          break;
        }
        case "UploadTankMeasurement": {
          const measuredAt = ptsLocalToUtc(data.DateTime, offset);
          const tank = int(data.Tank);
          const productVolume = num(data.ProductVolume);
          if (!measuredAt || !tank) {
            out.push(fail(id, type, 4, "JSONPTS_ERROR_WRONG_DATA"));
            break;
          }
          // بلا حجم (جدول معايرة غير مضبوط في الجهاز) لا قراءة باللترات تُكتب — يُؤكَّد حتى لا يعلق الجهاز في إعادة الإرسال
          if (productVolume != null) {
            const record: ParsedTankMeasurement = {
              tank, measuredAt, productVolume, productHeightMm: num(data.ProductHeight), waterHeightMm: num(data.WaterHeight), waterVolume: num(data.WaterVolume),
              temperatureC: num(data.Temperature), tcVolume: num(data.ProductTCVolume), ullage: num(data.ProductUllage), density: num(data.ProductDensity),
              mass: num(data.ProductMass), alarms: Array.isArray(data.Alarms) ? data.Alarms : undefined, raw: data,
            };
            await ingestTankMeasurements(controller.id, [record]);
          }
          out.push(ok(id, type));
          break;
        }
        case "UploadInTankDelivery": {
          await ingestInTankDelivery(controller, data, offset);
          out.push(ok(id, type));
          break;
        }
        case "UploadAlertRecord": {
          const occurredAt = ptsLocalToUtc(data.DateTime, offset);
          const code = int(data.Code);
          if (!occurredAt || code == null) {
            out.push(fail(id, type, 4, "JSONPTS_ERROR_WRONG_DATA"));
            break;
          }
          await prisma.forecourtAlertRecord.createMany({
            data: [{
              tenantId: controller.tenantId, companyId: controller.companyId, controllerId: controller.id, occurredAt,
              deviceType: String(data.DeviceType ?? ""), deviceNumber: int(data.DeviceNumber) ?? 0, state: String(data.State ?? ""), code,
              name: String(data.Name ?? ""), sensor: int(data.Sensor), rawPayload: data as Prisma.InputJsonValue,
            }],
            skipDuplicates: true,
          });
          out.push(ok(id, type));
          break;
        }
        case "UploadConfiguration": {
          await prisma.forecourtController.update({
            where: { id: controller.id },
            data: {
              configurationId: typeof packet.ConfigurationId === "string" ? packet.ConfigurationId : null,
              lastConfiguration: (Array.isArray(packet.Configuration) ? packet.Configuration : []) as Prisma.InputJsonValue,
              lastConfigurationAt: new Date(),
            },
          });
          out.push(ok(id, type));
          break;
        }
        default:
          // نوع غير مفعَّل في أثر (GPS، المدفوعات، الورديات، طلب الوسوم) — خطأ للحزمة؛ لا تُفعَّل هذه الأنواع في إعداد الجهاز
          out.push(fail(id, type || "Unknown", 1, "JSONPTS_ERROR_NOT_FOUND"));
      }
    } catch (err) {
      console.error("[pts] فشل معالجة حزمة", { controllerId: controller.id, type, id, err });
      out.push(fail(id, type, 5, "JSONPTS_ERROR_INTERNAL"));
    }
  }

  await touchController(controller.id, status);
  return { out };
}
