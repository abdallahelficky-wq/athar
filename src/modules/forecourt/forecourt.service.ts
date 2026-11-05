import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { isControllerConnected } from "./ptsWebsocket";

/**
 * متحكمات المحطات (Technotrade PTS-2) — الجزء غير المعتمد على بروتوكول jsonPTS:
 *  - تسجيل متحكم لكل محطة بمعرّف لوحته، وربط أرقام المضخات/الفوهات فيه بفوهات أثر (أرقام الخزانات عبر StationTank.atgTankNumber).
 *  - استقبال السجلات *بعد تحليلها* (ingestPumpTransactions / ingestTankMeasurements / touchController): كل الاستدعاءات هنا
 *    تأخذ سجلات منظَّمة بالحقول التي يوثّقها الدليل التقني (ص110–112)، لا رسائل خام. محلّل الرسائل ونقطة الاستقبال والتحقق
 *    من التوقيع تُبنى بعد وصول مواصفة jsonPTS (docs/design/pts2-integration.md).
 *  - قيمة "قراءة المتحكم" لكل فوهة في الوردية: عداد اللترات التراكمي في آخر عملية بيع انتهت قبل إغلاق الوردية — للمقارنة
 *    مع قراءة الصورة فقط؛ القيمة المعتمدة تبقى accountantConfirmedValue التي يكتبها/يقبلها المحاسب.
 *
 * كل شيء مقيَّد بشركة المتحكم المسجَّل: رقم مضخة/فوهة/خزان يُحَلّ فقط عبر ربط هذا المتحكم، فلا يصل جهاز إلى محطة غيره.
 */

const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SERIAL = /^[0-9A-Fa-f]{24}$/;

async function loadController(tenantId: string, id: string) {
  const c = await prisma.forecourtController.findFirst({ where: { id, tenantId } });
  if (!c) throw notFound("المتحكم غير موجود");
  return c;
}

export function controllerHealth(c: { isActive: boolean; lastSeenAt: Date | null; silentAfterMinutes: number }, now = new Date()) {
  if (!c.isActive) return "inactive" as const;
  if (!c.lastSeenAt) return "never_seen" as const;
  return now.getTime() - c.lastSeenAt.getTime() > c.silentAfterMinutes * 60_000 ? ("silent" as const) : ("online" as const);
}

export async function listControllers(tenantId: string, companyId: string) {
  const rows = await prisma.forecourtController.findMany({
    where: { tenantId, companyId },
    include: { costCenter: { select: { id: true, name: true } }, nozzleMaps: true },
    orderBy: { createdAt: "asc" },
  });
  const now = new Date();
  // المفتاح المشفَّر لا يغادر الخادم أبداً — يُعرَض فقط هل ضُبط ومتى (المفتاح نفسه يظهر مرة واحدة عند توليده)
  return rows.map(({ secretKeyEnc, lastConfiguration, ...c }) => ({
    ...c, hasSecret: Boolean(secretKeyEnc), hasConfiguration: lastConfiguration != null, health: controllerHealth(c, now),
    // متصل الآن بالاتصال الدائم (يقبل أوامر المضخات) — من ذاكرة الخادم
    online: isControllerConnected(c.id),
  }));
}

/** آخر تنبيهات المتحكمات (UploadAlertRecord) لشركة — للعرض. */
export async function listAlerts(tenantId: string, companyId: string, controllerId?: string) {
  return prisma.forecourtAlertRecord.findMany({
    where: { tenantId, companyId, ...(controllerId ? { controllerId } : {}) },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
}

export interface ControllerInput {
  companyId: string;
  costCenterId: string;
  deviceSerial: string;
  name?: string;
  firmwareVersion?: string;
  silentAfterMinutes?: number;
}

export async function createController(tenantId: string, input: ControllerInput) {
  const serial = input.deviceSerial.trim().toUpperCase();
  if (!SERIAL.test(serial)) throw badRequest("معرّف لوحة المتحكم يجب أن يكون 24 خانة ست عشرية (من صفحة معلومات الجهاز)");
  const station = await prisma.costCenter.findFirst({ where: { id: input.costCenterId, tenantId, companyId: input.companyId } });
  if (!station) throw badRequest("المحطة غير موجودة ضمن هذه الشركة");
  if (await prisma.forecourtController.findFirst({ where: { costCenterId: station.id } })) throw badRequest("لهذه المحطة متحكم مسجَّل بالفعل");
  // المعرّف فريد على مستوى المنصة كلها: الجهاز الواحد لا يُسجَّل لشركتين — رسالة عامة لا تكشف أين سُجِّل
  if (await prisma.forecourtController.findFirst({ where: { deviceSerial: serial } })) throw badRequest("هذا المتحكم مسجَّل بالفعل");
  const { secretKeyEnc, lastConfiguration, ...created } = await prisma.forecourtController.create({
    data: {
      tenantId, companyId: input.companyId, costCenterId: station.id, deviceSerial: serial, name: input.name, firmwareVersion: input.firmwareVersion,
      ...(input.silentAfterMinutes ? { silentAfterMinutes: input.silentAfterMinutes } : {}),
    },
  });
  return { ...created, hasSecret: Boolean(secretKeyEnc), hasConfiguration: lastConfiguration != null };
}

export async function updateController(tenantId: string, id: string, input: { name?: string; firmwareVersion?: string; silentAfterMinutes?: number; isActive?: boolean }) {
  const c = await loadController(tenantId, id);
  const { secretKeyEnc, lastConfiguration, ...updated } = await prisma.forecourtController.update({ where: { id: c.id }, data: input });
  return { ...updated, hasSecret: Boolean(secretKeyEnc), hasConfiguration: lastConfiguration != null };
}

/** ربط رقم مضخة/فوهة في المتحكم بفوهة أثر (أو فكّه بـnozzleId=null). الفوهة من نفس محطة المتحكم. */
export async function setNozzleMap(tenantId: string, controllerId: string, input: { ptsPump: number; ptsNozzle: number; nozzleId: string | null }) {
  const c = await loadController(tenantId, controllerId);
  const key = { controllerId_ptsPump_ptsNozzle: { controllerId: c.id, ptsPump: input.ptsPump, ptsNozzle: input.ptsNozzle } };
  if (!input.nozzleId) {
    await prisma.forecourtNozzleMap.deleteMany({ where: { controllerId: c.id, ptsPump: input.ptsPump, ptsNozzle: input.ptsNozzle } });
    return { removed: true };
  }
  const nozzle = await prisma.stationNozzle.findFirst({ where: { id: input.nozzleId, tenantId, companyId: c.companyId, costCenterId: c.costCenterId } });
  if (!nozzle) throw badRequest("الفوهة ليست في محطة هذا المتحكم");
  return prisma.$transaction(async (tx) => {
    // فوهة أثر واحدة ↔ رقم واحد في المتحكم: يُفَكّ أي ربط سابق لنفس الفوهة قبل الربط الجديد
    await tx.forecourtNozzleMap.deleteMany({ where: { nozzleId: nozzle.id, NOT: { controllerId: c.id, ptsPump: input.ptsPump, ptsNozzle: input.ptsNozzle } } });
    const map = await tx.forecourtNozzleMap.upsert({ where: key, create: { controllerId: c.id, ptsPump: input.ptsPump, ptsNozzle: input.ptsNozzle, nozzleId: nozzle.id }, update: { nozzleId: nozzle.id } });
    // عمليات سابقة وصلت بهذا الرقم قبل ربطه تُنسَب للفوهة الآن
    await tx.forecourtPumpTransaction.updateMany({ where: { controllerId: c.id, ptsPump: input.ptsPump, ptsNozzle: input.ptsNozzle, nozzleId: null }, data: { nozzleId: nozzle.id } });
    return map;
  });
}

// ===== الاستقبال (سجلات مُحلَّلة) =====

export interface ParsedPumpTransaction {
  pump: number;
  nozzle: number;
  transactionNumber: number;
  startedAt?: Date | null;
  endedAt: Date;
  volume: number;
  tcVolume?: number | null;
  amount?: number | null;
  price?: number | null;
  totalVolume?: number | null;
  totalAmount?: number | null;
  tag?: string | null;
  raw?: unknown;
}

export interface ParsedTankMeasurement {
  tank: number;
  measuredAt: Date;
  productVolume: number;
  productHeightMm?: number | null;
  waterHeightMm?: number | null;
  waterVolume?: number | null;
  temperatureC?: number | null;
  tcVolume?: number | null;
  ullage?: number | null;
  density?: number | null;
  mass?: number | null;
  alarms?: unknown;
  raw?: unknown;
}

/** يُحدِّث آخر ظهور للجهاز (وحالته إن وصلت) — كل رسالة ناجحة تمرّ به. */
export async function touchController(controllerId: string, status?: unknown, at = new Date()) {
  await prisma.forecourtController.update({
    where: { id: controllerId },
    data: { lastSeenAt: at, ...(status !== undefined ? { lastStatus: status as Prisma.InputJsonValue } : {}) },
  });
}

/**
 * عمليات البيع — إدراج بلا تكرار: الدليل يوثّق أن عدّاد "المرفوع" قابل للتصفير لإعادة الإرسال (ص114)، فالتكرار متوقَّع.
 * مفتاح التكرار (متحكم، مضخة، رقم العملية، وقت نهايتها) — مؤقت حتى تحدد المواصفة معرّف السجل.
 */
export async function ingestPumpTransactions(controllerId: string, records: ParsedPumpTransaction[]) {
  const c = await prisma.forecourtController.findUniqueOrThrow({ where: { id: controllerId } });
  const maps = await prisma.forecourtNozzleMap.findMany({ where: { controllerId: c.id } });
  const nozzleFor = (pump: number, nozzle: number) => maps.find((m) => m.ptsPump === pump && m.ptsNozzle === nozzle)?.nozzleId ?? null;
  const result = await prisma.forecourtPumpTransaction.createMany({
    data: records.map((r) => ({
      tenantId: c.tenantId, companyId: c.companyId, controllerId: c.id, ptsPump: r.pump, ptsNozzle: r.nozzle, nozzleId: nozzleFor(r.pump, r.nozzle),
      transactionNumber: r.transactionNumber, startedAt: r.startedAt ?? null, endedAt: r.endedAt, volume: r.volume, tcVolume: r.tcVolume ?? null,
      amount: r.amount ?? null, price: r.price ?? null, totalVolume: r.totalVolume ?? null, totalAmount: r.totalAmount ?? null, tag: r.tag ?? null,
      rawPayload: (r.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
    skipDuplicates: true,
  });
  await touchController(c.id);
  return { received: records.length, inserted: result.count };
}

/**
 * قياسات الخزانات — قراءة TankReading بمصدر atg على خزان المحطة الذي رقمه في الجهاز = رقم الخزان في الرسالة. خزان غير
 * معرَّف بهذا الرقم في محطة المتحكم يُتخطّى ويُعَدّ (لا يُكتَب على خزان محطة أخرى أبداً). بلا تكرار عبر externalId.
 */
export async function ingestTankMeasurements(controllerId: string, records: ParsedTankMeasurement[]) {
  const c = await prisma.forecourtController.findUniqueOrThrow({ where: { id: controllerId } });
  const tanks = await prisma.stationTank.findMany({ where: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.costCenterId, atgTankNumber: { not: null } } });
  let inserted = 0;
  let unmapped = 0;
  for (const r of records) {
    const tank = tanks.find((t) => t.atgTankNumber === r.tank);
    if (!tank) { unmapped += 1; continue; }
    const externalId = `${c.deviceSerial}:${r.tank}:${r.measuredAt.toISOString()}`;
    const created = await prisma.tankReading.createMany({
      data: [{
        tenantId: c.tenantId, companyId: c.companyId, tankId: tank.id, source: "atg", purpose: "spot", readAt: r.measuredAt, liters: r.productVolume,
        heightMm: r.productHeightMm ?? null, waterHeightMm: r.waterHeightMm ?? null, waterLiters: r.waterVolume ?? null, temperatureC: r.temperatureC ?? null,
        tcLiters: r.tcVolume ?? null, ullageLiters: r.ullage ?? null, density: r.density ?? null, massKg: r.mass ?? null,
        alarms: (r.alarms ?? undefined) as Prisma.InputJsonValue | undefined, deviceId: c.id, externalId,
        rawPayload: (r.raw ?? undefined) as Prisma.InputJsonValue | undefined,
      }],
      skipDuplicates: true,
    });
    inserted += created.count;
  }
  await touchController(c.id);
  return { received: records.length, inserted, unmapped };
}

// ===== قراءة المتحكم للوردية =====

export interface ControllerReadingValue {
  readingId: string;
  controllerValue: number | null;
  capturedAt: Date | null;
}

/**
 * لكل قراءة في الوردية: عداد اللترات التراكمي في آخر عملية بيع على فوهتها انتهت حتى إغلاق الوردية (أو الآن إن لم تُغلَق).
 * null إن لم تكن الفوهة مربوطة بمتحكم أو لا عمليات بعد. للعرض والمقارنة فقط — لا يكتب شيئاً.
 */
export async function controllerValuesForShift(tenantId: string, shift: { companyId: string; closedAt: Date | null; readings: { id: string; nozzleId: string }[] }): Promise<ControllerReadingValue[]> {
  const nozzleIds = shift.readings.map((r) => r.nozzleId);
  if (!nozzleIds.length) return [];
  const mapped = await prisma.forecourtNozzleMap.findMany({ where: { nozzleId: { in: nozzleIds }, controller: { tenantId, companyId: shift.companyId } }, select: { nozzleId: true } });
  if (!mapped.length) return shift.readings.map((r) => ({ readingId: r.id, controllerValue: null, capturedAt: null }));
  const cutoff = shift.closedAt ?? new Date();
  const out: ControllerReadingValue[] = [];
  for (const r of shift.readings) {
    const tx = mapped.some((m) => m.nozzleId === r.nozzleId)
      ? await prisma.forecourtPumpTransaction.findFirst({
          where: { tenantId, companyId: shift.companyId, nozzleId: r.nozzleId, endedAt: { lte: cutoff }, totalVolume: { not: null } },
          orderBy: { endedAt: "desc" },
        })
      : null;
    out.push({ readingId: r.id, controllerValue: tx?.totalVolume != null ? d(tx.totalVolume).toNumber() : null, capturedAt: tx?.endedAt ?? null });
  }
  return out;
}

export async function listTransactions(tenantId: string, companyId: string, controllerId?: string) {
  return prisma.forecourtPumpTransaction.findMany({
    where: { tenantId, companyId, ...(controllerId ? { controllerId } : {}) },
    orderBy: { endedAt: "desc" },
    take: 300,
  });
}
