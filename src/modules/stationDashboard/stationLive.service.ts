import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";
import { riyadhCalendarDay, riyadhDayEndExclusiveUtc, riyadhDayStartUtc } from "../../lib/riyadhDate";
import { controllerHealth } from "../forecourt/forecourt.service";
import { isControllerConnected } from "../forecourt/ptsWebsocket";
import { ptsLocalToUtc } from "../forecourt/ptsReceiver.service";
import { parseLiveStatus } from "./stationLive.parse";
import { openShiftsWithSales } from "../stationShifts/stationShifts.service";

/**
 * الشاشة الحيّة لمحطة واحدة — ما يعرضه متحكمها الآن: حالة كل نقطة تعبئة (خاملة/تعبّئ ومعها اللترات والمبلغ لحظياً/نهاية عملية/
 * غير متصلة)، ومستوى كل خزان من مسباره، ومبيعات اليوم وآخر العمليات. المصدر آخر UploadStatus خزّنه الاستقبال (lastStatus) —
 * تحديثه بقدر فترة إرسال الحالة المضبوطة في الجهاز — مع ربط أرقام المضخات/الفوهات والخزانات بما عُرِّف في أثر.
 * قراءة فقط، ومقيَّدة بمستأجر الطلب وشركته: المحطة والمتحكم والفوهات والخزانات والعمليات كلها تُجلَب بـ tenantId وcompanyId.
 */

const n = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const round = (v: number, digits = 2) => Number(v.toFixed(digits));

export async function getStationLive(tenantId: string, companyId: string, costCenterId: string) {
  const station = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId, companyId }, select: { id: true, name: true, nameEn: true } });
  if (!station) throw notFound("المحطة غير موجودة");

  const [controller, nozzles, tanks] = await Promise.all([
    prisma.forecourtController.findFirst({ where: { tenantId, companyId, costCenterId: station.id }, include: { nozzleMaps: true } }),
    prisma.stationNozzle.findMany({ where: { tenantId, companyId, costCenterId: station.id, isActive: true }, orderBy: [{ pumpNumber: "asc" }, { nozzleNumber: "asc" }] }),
    prisma.stationTank.findMany({ where: { tenantId, companyId, costCenterId: station.id, isActive: true }, orderBy: { code: "asc" } }),
  ]);

  const stationOut = { costCenterId: station.id, name: station.name, nameEn: station.nameEn };
  if (!controller) {
    return { station: stationOut, controller: null, pumps: [], tanks: tanks.map((t) => ({ tankId: t.id, code: t.code, product: t.product, capacityLiters: n(t.capacityLiters), atgTankNumber: t.atgTankNumber, probe: null })), today: null, recent: [] };
  }

  const live = parseLiveStatus(controller.lastStatus);
  const nozzleById = new Map(nozzles.map((z) => [z.id, z]));
  const mapsByPump = new Map<number, { ptsNozzle: number; nozzleId: string; pumpNumber: number; nozzleNumber: number; product: string }[]>();
  for (const m of controller.nozzleMaps) {
    const z = nozzleById.get(m.nozzleId);
    if (!z) continue;
    const list = mapsByPump.get(m.ptsPump) ?? [];
    list.push({ ptsNozzle: m.ptsNozzle, nozzleId: z.id, pumpNumber: z.pumpNumber, nozzleNumber: z.nozzleNumber, product: z.product });
    mapsByPump.set(m.ptsPump, list);
  }
  const productFor = (ptsPump: number, ptsNozzle: number | null) => {
    const list = mapsByPump.get(ptsPump) ?? [];
    if (ptsNozzle) return list.find((x) => x.ptsNozzle === ptsNozzle)?.product ?? null;
    return list.length === 1 ? list[0].product : null;
  };

  // نقاط معرَّفة في الربط ولم ترد في الحالة بعد تظهر "غير معروفة" بدل أن تختفي
  const seen = new Set(live.pumps.map((p) => p.ptsPump));
  const pumps = [
    ...live.pumps,
    ...[...mapsByPump.keys()].filter((p) => !seen.has(p)).map((ptsPump) => ({ ...parseLiveStatus({ Pumps: { OfflineStatus: { Ids: [ptsPump] } } }).pumps[0], state: "unknown" as const })),
  ]
    .sort((a, b) => a.ptsPump - b.ptsPump)
    .map((p) => ({ ...p, product: productFor(p.ptsPump, p.nozzle ?? p.lastNozzle), nozzles: mapsByPump.get(p.ptsPump) ?? [] }));

  const probes = new Map(live.probes.map((p) => [p.probe, p]));
  const tanksOut = tanks.map((t) => {
    const probe = t.atgTankNumber ? probes.get(t.atgTankNumber) ?? null : null;
    const capacity = n(t.capacityLiters) ?? 0;
    return {
      tankId: t.id, code: t.code, product: t.product, capacityLiters: capacity, atgTankNumber: t.atgTankNumber,
      probe: probe && {
        ...probe,
        // النسبة من الحجم إن عرفه الجهاز (جدول معايرة)، وإلا نسبة الجهاز نفسه
        fillPct: probe.productLiters != null && capacity > 0 ? round((probe.productLiters / capacity) * 100, 1) : probe.fillPct,
      },
    };
  });

  const today = riyadhCalendarDay(new Date());
  const [todayTx, recentTx, openShifts, alerts] = await Promise.all([
    prisma.forecourtPumpTransaction.findMany({
      where: { tenantId, companyId, controllerId: controller.id, endedAt: { gte: riyadhDayStartUtc(today), lt: riyadhDayEndExclusiveUtc(today) } },
      select: { volume: true, amount: true, nozzleId: true },
    }),
    prisma.forecourtPumpTransaction.findMany({
      where: { tenantId, companyId, controllerId: controller.id },
      orderBy: { endedAt: "desc" },
      take: 15,
    }),
    openShiftsWithSales(tenantId, companyId, [station.id]),
    prisma.forecourtAlertRecord.findMany({ where: { tenantId, companyId, controllerId: controller.id }, orderBy: { occurredAt: "desc" }, take: 20 }),
  ]);
  const byProduct: Record<string, { liters: number; amount: number; count: number }> = {};
  let liters = 0;
  let amount = 0;
  for (const tx of todayTx) {
    const product = (tx.nozzleId && nozzleById.get(tx.nozzleId)?.product) || "unmapped";
    const v = Number(tx.volume);
    const a = tx.amount == null ? 0 : Number(tx.amount);
    const slot = byProduct[product] ?? (byProduct[product] = { liters: 0, amount: 0, count: 0 });
    slot.liters += v; slot.amount += a; slot.count += 1;
    liters += v; amount += a;
  }
  for (const k of Object.keys(byProduct)) byProduct[k] = { ...byProduct[k], liters: round(byProduct[k].liters, 3), amount: round(byProduct[k].amount) };

  const statusAt = ptsLocalToUtc(live.deviceDateTime, controller.utcOffsetMinutes);
  return {
    station: stationOut,
    controller: {
      id: controller.id, name: controller.name, health: controllerHealth(controller), commandsOnline: isControllerConnected(controller.id),
      lastSeenAt: controller.lastSeenAt, statusAt, batteryVoltageMv: live.batteryVoltageMv, cpuTemperatureC: live.cpuTemperatureC,
    },
    pumps,
    tanks: tanksOut,
    fuelGrades: live.fuelGrades,
    today: { day: today, count: todayTx.length, liters: round(liters, 3), amount: round(amount), byProduct },
    openShifts: openShifts.get(station.id) ?? [],
    alerts: alerts.map((a) => ({ id: a.id, occurredAt: a.occurredAt, deviceType: a.deviceType, deviceNumber: a.deviceNumber, name: a.name, code: a.code, state: a.state })),
    recent: recentTx.map((tx) => {
      const z = tx.nozzleId ? nozzleById.get(tx.nozzleId) : undefined;
      return {
        id: tx.id, endedAt: tx.endedAt, ptsPump: tx.ptsPump, ptsNozzle: tx.ptsNozzle, transactionNumber: tx.transactionNumber,
        volume: n(tx.volume), amount: n(tx.amount), price: n(tx.price), pumpNumber: z?.pumpNumber ?? null, product: z?.product ?? null,
      };
    }),
  };
}
