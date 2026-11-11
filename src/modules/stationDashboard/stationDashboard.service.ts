import { Prisma, StationFuelProduct } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { riyadhCalendarDay, riyadhDayEndExclusiveUtc, riyadhDayStartUtc } from "../../lib/riyadhDate";
import { computeNozzleLiters, resolveEffectivePrice, type FuelPriceInput } from "../stationShifts/stationShifts.service";
import { controllerHealth } from "../forecourt/forecourt.service";
import { parseLiveStatus, type LiveProbe } from "./stationLive.parse";

/**
 * لوحة إدارة محطات الوقود — قراءة فقط، تجمع ما يسجّله النظام فعلاً، بلا أي حساب جديد للأرقام:
 *  - المبيعات الفعلية: لكل محطة ولكل يوم — إن رفع متحكم المحطة عمليات بيع ذلك اليوم فهي المبيعات (ما خرج من الفوهات فعلاً،
 *    بلتراتها ومبالغها كما سجّلها الجهاز، والمنتج من فوهة أثر المربوطة)، وإلا فمبيعات الورديات المعتمَدة/المرحَّلة (بلا البذرة)
 *    بتاريخ الوردية — نفس computeNozzleLiters وresolveEffectivePrice. ويُعرَض بجانبها ما اعتُمد من الورديات (approved) للمقارنة.
 *    ما لم يُعتمَد بعد يظهر عدداً منفصلاً (بانتظار المراجعة/الترحيل) لا رقماً. التحصيل من الورديات المعتمدة دائماً.
 *  - مبيعات اليوم لحظياً وبالساعة: من عمليات البيع التي رفعها متحكم المحطة (ForecourtPumpTransaction) — لمحطة لها متحكم فقط.
 *  - الخزانات: آخر قراءة غير ملغاة لكل خزان (يدوية أو آلية)، وقياس مسباره الآن من آخر حالة رفعها المتحكم (ارتفاع الوقود والماء
 *    والحرارة والحجم والنسبة) — ويُستعمَل حجم المسبار إن لم توجد قراءة، ونسبة الجهاز إن لم يُعرَف الحجم (قبل جدول المعايرة). أيام
 *    التغطية = الرصيد ÷ متوسط المبيع اليومي عبر فوهات الخزان في آخر 7 أيام (عمليات المتحكم إن وُجدت، وإلا الورديات المعتمدة).
 *  - التوريدات المؤكَّدة في الفترة، وتنبيهات المتحكم آخر 7 أيام، وحالة اتصاله.
 * كل استعلام مقيَّد بالمستأجر والشركة؛ المحطة المطلوبة بالمعرّف يُتحقَّق أنها من نفس الشركة.
 */

const REPORTED = ["approved", "posted"] as const;
const AWAITING_REVIEW = ["open", "submitted", "under_review"] as const;
const PRODUCTS: StationFuelProduct[] = ["gasoline_91", "gasoline_95", "diesel"];
const MAX_RANGE_DAYS = 92;
const LOW_FILL_PCT = 20;
const COVER_WINDOW_DAYS = 7;

const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round = (v: Prisma.Decimal | number, places = 2) => Number(d(v).toDecimalPlaces(places));
const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const shiftDay = (date: Date) => date.toISOString().slice(0, 10);

export interface DashboardRange {
  from: string;
  to: string;
}

function assertRange(range: DashboardRange) {
  if (range.from > range.to) throw badRequest("تاريخ البداية بعد تاريخ النهاية");
  const span = (dayStart(range.to).getTime() - dayStart(range.from).getTime()) / 86_400_000;
  if (span > MAX_RANGE_DAYS) throw badRequest("فترة لوحة المحطات أطول من الحد المسموح (92 يوماً) — اختر فترة أقصر");
}

/** كل الأيام في الفترة (YYYY-MM-DD) — حتى يظهر اليوم بلا مبيعات صفراً في الرسم لا فجوة. */
function daysOf(range: DashboardRange) {
  const out: string[] = [];
  for (let t = dayStart(range.from).getTime(); t <= dayStart(range.to).getTime(); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

type ProductTotals = Record<StationFuelProduct, { liters: number; value: number }>;
const emptyProducts = (): ProductTotals => ({ gasoline_91: { liters: 0, value: 0 }, gasoline_95: { liters: 0, value: 0 }, diesel: { liters: 0, value: 0 } });

/** مبيعات الورديات المعتمدة/المرحَّلة لمحطات: لكل محطة، ولكل يوم، ولكل منتج — لترات وقيمة شاملة الضريبة. */
async function shiftSales(tenantId: string, companyId: string, stationIds: string[], range: DashboardRange) {
  const [readings, priceRows] = await Promise.all([
    prisma.stationShiftReading.findMany({
      where: {
        tenantId, companyId,
        shift: { status: { in: [...REPORTED] }, isSeedData: false, costCenterId: { in: stationIds }, shiftDate: { gte: dayStart(range.from), lte: dayStart(range.to) } },
      },
      include: { nozzle: true, shift: { select: { id: true, costCenterId: true, shiftDate: true } } },
    }),
    prisma.fuelPrice.findMany({ where: { tenantId, companyId } }),
  ]);
  const pricesFor = (stationId: string): FuelPriceInput[] => priceRows.filter((p) => !p.costCenterId || p.costCenterId === stationId);

  const byStation = new Map<string, { products: ProductTotals; shiftIds: Set<string>; byDay: Map<string, ProductTotals> }>();
  let unpriced = 0;
  for (const r of readings) {
    const closing = r.accountantConfirmedValue ?? r.closingReading;
    if (closing == null) continue;
    const liters = computeNozzleLiters({
      nozzleId: r.nozzleId, product: r.nozzle.product, meterDigits: r.nozzle.meterDigits,
      openingReading: r.openingReading, closingReading: closing, testLiters: r.testLiters,
    });
    let value = d(0);
    try {
      value = liters.times(resolveEffectivePrice(r.nozzle.product, r.shift.shiftDate, pricesFor(r.shift.costCenterId))).toDecimalPlaces(2);
    } catch {
      unpriced += 1; // وردية معتمدة بلا سعر ساري مستحيلة عملياً — تُعَدّ ولا تُسقط اللترات
    }
    const station = byStation.get(r.shift.costCenterId) ?? { products: emptyProducts(), shiftIds: new Set<string>(), byDay: new Map() };
    const day = shiftDay(r.shift.shiftDate);
    const dayTotals = station.byDay.get(day) ?? emptyProducts();
    for (const bucket of [station.products[r.nozzle.product], dayTotals[r.nozzle.product]]) {
      bucket.liters = round(d(bucket.liters).plus(liters), 3);
      bucket.value = round(d(bucket.value).plus(value));
    }
    station.byDay.set(day, dayTotals);
    station.shiftIds.add(r.shift.id);
    byStation.set(r.shift.costCenterId, station);
  }
  return { byStation, unpriced };
}

async function collections(tenantId: string, companyId: string, stationIds: string[], range: DashboardRange) {
  const rows = await prisma.stationShiftCollection.findMany({
    where: {
      tenantId, companyId,
      shift: { status: { in: [...REPORTED] }, isSeedData: false, costCenterId: { in: stationIds }, shiftDate: { gte: dayStart(range.from), lte: dayStart(range.to) } },
    },
    include: { shift: { select: { costCenterId: true } } },
  });
  const out = new Map<string, { cash: number; network: number; fuelCard: number }>();
  for (const r of rows) {
    const t = out.get(r.shift.costCenterId) ?? { cash: 0, network: 0, fuelCard: 0 };
    t.cash = round(d(t.cash).plus(r.cashDelivered));
    t.network = round(d(t.network).plus(r.networkAmount));
    t.fuelCard = round(d(t.fuelCard).plus(r.fuelCardAmount));
    out.set(r.shift.costCenterId, t);
  }
  return out;
}

type DaySales = ProductTotals & { unmapped: { liters: number; value: number } };
const emptyDay = (): DaySales => ({ ...emptyProducts(), unmapped: { liters: 0, value: 0 } });
const dayLiters = (t: DaySales | ProductTotals) => PRODUCTS.reduce((n, p) => n + t[p].liters, 0) + ("unmapped" in t ? t.unmapped.liters : 0);
const dayValue = (t: DaySales | ProductTotals) => PRODUCTS.reduce((n, p) => n + t[p].value, 0) + ("unmapped" in t ? t.unmapped.value : 0);

/** عمليات بيع المتحكمات في الفترة (أيام الرياض) — لكل محطة ولكل يوم ولكل منتج؛ عملية بلا فوهة مربوطة تُحسب "غير مربوطة". */
async function controllerSales(tenantId: string, companyId: string, stationIds: string[], range: DashboardRange) {
  const txs = await prisma.forecourtPumpTransaction.findMany({
    where: { tenantId, companyId, controller: { costCenterId: { in: stationIds } }, endedAt: { gte: riyadhDayStartUtc(range.from), lt: riyadhDayEndExclusiveUtc(range.to) } },
    select: { endedAt: true, volume: true, amount: true, nozzleId: true, controller: { select: { costCenterId: true } } },
  });
  const nozzleIds = [...new Set(txs.map((t) => t.nozzleId).filter((id): id is string => !!id))];
  const products = new Map((await prisma.stationNozzle.findMany({ where: { tenantId, companyId, id: { in: nozzleIds } }, select: { id: true, product: true } })).map((n) => [n.id, n.product]));
  const byStation = new Map<string, { byDay: Map<string, DaySales>; count: number }>();
  for (const t of txs) {
    const station = byStation.get(t.controller.costCenterId) ?? { byDay: new Map<string, DaySales>(), count: 0 };
    const day = riyadhCalendarDay(t.endedAt);
    const totals = station.byDay.get(day) ?? emptyDay();
    const product = t.nozzleId ? products.get(t.nozzleId) : undefined;
    const bucket = product ? totals[product] : totals.unmapped;
    bucket.liters = round(d(bucket.liters).plus(t.volume), 3);
    bucket.value = round(d(bucket.value).plus(t.amount ?? 0));
    station.byDay.set(day, totals);
    station.count += 1;
    byStation.set(t.controller.costCenterId, station);
  }
  return byStation;
}

/** قياس مسبار كل خزان الآن من آخر حالة رفعها متحكم محطته — مفتاحها المحطة ثم رقم المسبار (atgTankNumber). */
async function probesNow(tenantId: string, companyId: string, stationIds: string[]) {
  const controllers = await prisma.forecourtController.findMany({
    where: { tenantId, companyId, costCenterId: { in: stationIds }, isActive: true },
    select: { costCenterId: true, lastStatus: true, lastSeenAt: true },
  });
  const out = new Map<string, { probes: Map<number, LiveProbe>; at: Date | null }>();
  for (const c of controllers) out.set(c.costCenterId, { probes: new Map(parseLiveStatus(c.lastStatus).probes.map((p) => [p.probe, p])), at: c.lastSeenAt });
  return out;
}

/** الخزانات: آخر قراءة غير ملغاة، الامتلاء، وأيام التغطية من متوسط مبيع آخر 7 أيام عبر فوهات كل خزان. */
async function tanksState(tenantId: string, companyId: string, stationIds: string[]) {
  const tanks = await prisma.stationTank.findMany({
    where: { tenantId, companyId, costCenterId: { in: stationIds }, isActive: true },
    orderBy: [{ costCenterId: "asc" }, { code: "asc" }],
  });
  if (!tanks.length) return [];
  const today = riyadhCalendarDay(new Date());
  const windowFrom = new Date(dayStart(today).getTime() - (COVER_WINDOW_DAYS - 1) * 86_400_000);
  const windowFromDay = shiftDay(windowFrom);
  const tankNozzles = await prisma.stationNozzle.findMany({ where: { tenantId, companyId, tankId: { in: tanks.map((t) => t.id) } }, select: { id: true, tankId: true } });
  const tankOfNozzle = new Map(tankNozzles.map((z) => [z.id, z.tankId!]));
  const [probes, controllerTx] = await Promise.all([
    probesNow(tenantId, companyId, stationIds),
    prisma.forecourtPumpTransaction.findMany({
      where: { tenantId, companyId, nozzleId: { in: [...tankOfNozzle.keys()] }, endedAt: { gte: riyadhDayStartUtc(windowFromDay), lt: riyadhDayEndExclusiveUtc(today) } },
      select: { volume: true, nozzleId: true },
    }),
  ]);
  const controllerSoldByTank = new Map<string, Prisma.Decimal>();
  for (const t of controllerTx) {
    const tankId = t.nozzleId ? tankOfNozzle.get(t.nozzleId) : undefined;
    if (!tankId) continue;
    controllerSoldByTank.set(tankId, (controllerSoldByTank.get(tankId) ?? d(0)).plus(t.volume));
  }
  const soldReadings = await prisma.stationShiftReading.findMany({
    where: {
      tenantId, companyId, nozzle: { tankId: { in: tanks.map((t) => t.id) } },
      shift: { status: { in: [...REPORTED] }, isSeedData: false, shiftDate: { gte: windowFrom, lte: dayStart(today) } },
    },
    include: { nozzle: true },
  });
  const soldByTank = new Map<string, Prisma.Decimal>();
  for (const r of soldReadings) {
    const closing = r.accountantConfirmedValue ?? r.closingReading;
    if (closing == null || !r.nozzle.tankId) continue;
    const liters = computeNozzleLiters({
      nozzleId: r.nozzleId, product: r.nozzle.product, meterDigits: r.nozzle.meterDigits,
      openingReading: r.openingReading, closingReading: closing, testLiters: r.testLiters,
    });
    soldByTank.set(r.nozzle.tankId, (soldByTank.get(r.nozzle.tankId) ?? d(0)).plus(liters));
  }

  const out = [];
  for (const tank of tanks) {
    const last = await prisma.tankReading.findFirst({
      where: { tenantId, companyId, tankId: tank.id, voidedAt: null },
      orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
    });
    const capacity = Number(tank.capacityLiters);
    const station = probes.get(tank.costCenterId);
    const probe = tank.atgTankNumber != null ? station?.probes.get(tank.atgTankNumber) ?? null : null;
    const probeLiters = probe?.online && probe.productLiters != null ? probe.productLiters : null;
    // المسبار الآن أحدث من أي قراءة مخزَّنة؛ وبلا حجم منه (قبل جدول المعايرة) تبقى آخر قراءة
    const liters = probeLiters ?? (last ? Number(last.liters) : null);
    const sold = controllerSoldByTank.get(tank.id) ?? soldByTank.get(tank.id) ?? d(0);
    const avgDaily = round(sold.dividedBy(COVER_WINDOW_DAYS), 1);
    const fillPct = liters != null && capacity > 0 ? round((liters / capacity) * 100, 1) : probe?.online && probe.fillPct != null ? probe.fillPct : null;
    out.push({
      tankId: tank.id, costCenterId: tank.costCenterId, code: tank.code, product: tank.product, capacityLiters: capacity,
      liters, fillPct, readAt: probeLiters != null ? station?.at ?? null : last?.readAt ?? null, source: probeLiters != null ? "atg" : last?.source ?? null,
      waterHeightMm: probe?.online && probe.waterHeightMm != null ? probe.waterHeightMm : last?.waterHeightMm != null ? Number(last.waterHeightMm) : null,
      temperatureC: probe?.online && probe.temperatureC != null ? probe.temperatureC : last?.temperatureC != null ? Number(last.temperatureC) : null,
      probe: probe && {
        online: probe.online, productHeightMm: probe.productHeightMm, waterHeightMm: probe.waterHeightMm, temperatureC: probe.temperatureC,
        productLiters: probe.productLiters, fillPct: probe.fillPct, alarms: probe.alarms, at: station?.at ?? null,
      },
      avgDailySold: avgDaily, daysOfCover: liters != null && avgDaily > 0 ? round(liters / avgDaily, 1) : null,
      low: fillPct != null && fillPct < LOW_FILL_PCT,
    });
  }
  return out;
}

/** مبيعات المتحكم في يوم (أيام الرياض) — لكل محطة، ولكل ساعة محلية، ولكل منتج (منتج فوهة أثر المربوطة). */
async function controllerSalesForDay(tenantId: string, companyId: string, stationIds: string[], day: string) {
  const txs = await prisma.forecourtPumpTransaction.findMany({
    where: {
      tenantId, companyId, controller: { costCenterId: { in: stationIds } },
      endedAt: { gte: riyadhDayStartUtc(day), lt: riyadhDayEndExclusiveUtc(day) },
    },
    include: { controller: { select: { costCenterId: true } } },
  });
  const nozzleIds = [...new Set(txs.map((t) => t.nozzleId).filter((id): id is string => !!id))];
  const products = new Map((await prisma.stationNozzle.findMany({ where: { id: { in: nozzleIds } }, select: { id: true, product: true } })).map((n) => [n.id, n.product]));
  const byStation = new Map<string, { liters: number; amount: number; count: number; hourly: { hour: number; liters: number; amount: number }[] }>();
  for (const t of txs) {
    const s = byStation.get(t.controller.costCenterId) ?? { liters: 0, amount: 0, count: 0, hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, liters: 0, amount: 0 })) };
    const hour = (t.endedAt.getUTCHours() + 3) % 24; // ساعة الرياض (UTC+3 بلا توقيت صيفي)
    s.liters = round(d(s.liters).plus(t.volume), 3);
    s.amount = round(d(s.amount).plus(t.amount ?? 0));
    s.count += 1;
    s.hourly[hour].liters = round(d(s.hourly[hour].liters).plus(t.volume), 3);
    s.hourly[hour].amount = round(d(s.hourly[hour].amount).plus(t.amount ?? 0));
    byStation.set(t.controller.costCenterId, s);
  }
  return { byStation, unmappedTransactions: txs.filter((t) => !t.nozzleId || !products.get(t.nozzleId)).length };
}

async function loadStations(tenantId: string, companyId: string, costCenterId?: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  if (costCenterId) {
    const station = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId, companyId }, select: { id: true, name: true } });
    if (!station) throw notFound("المحطة غير موجودة");
    return [station];
  }
  return prisma.costCenter.findMany({ where: { tenantId, companyId, stationNozzles: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** ملخص كل محطة — يُستعمل في نظرة كل المحطات وفي رأس صفحة المحطة الواحدة. */
async function stationSummaries(tenantId: string, companyId: string, stations: { id: string; name: string }[], range: DashboardRange) {
  const ids = stations.map((s) => s.id);
  const today = riyadhCalendarDay(new Date());
  const [{ byStation: approved, unpriced }, actualFromController, cash, tanks, live, controllers, pending, deliveries, alerts] = await Promise.all([
    shiftSales(tenantId, companyId, ids, range),
    controllerSales(tenantId, companyId, ids, range),
    collections(tenantId, companyId, ids, range),
    tanksState(tenantId, companyId, ids),
    controllerSalesForDay(tenantId, companyId, ids, today),
    prisma.forecourtController.findMany({ where: { tenantId, companyId, costCenterId: { in: ids } }, select: { id: true, costCenterId: true, isActive: true, lastSeenAt: true, silentAfterMinutes: true } }),
    prisma.stationShift.groupBy({
      by: ["costCenterId", "status"],
      where: { tenantId, companyId, isSeedData: false, costCenterId: { in: ids }, status: { in: [...AWAITING_REVIEW, "approved"] } },
      _count: { _all: true },
    }),
    prisma.fuelDelivery.findMany({
      where: { tenantId, companyId, costCenterId: { in: ids }, status: "confirmed", deliveredAt: { gte: riyadhDayStartUtc(range.from), lt: riyadhDayEndExclusiveUtc(range.to) } },
      include: { lines: true },
    }),
    prisma.forecourtAlertRecord.findMany({
      where: { tenantId, companyId, occurredAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, controller: { costCenterId: { in: ids } } },
      include: { controller: { select: { costCenterId: true } } },
      orderBy: { occurredAt: "desc" },
    }),
  ]);
  // المبيعات الفعلية لكل محطة ويوم: عمليات المتحكم إن وُجدت ذلك اليوم، وإلا الورديات المعتمدة
  const sales = new Map<string, { products: ProductTotals; unmapped: { liters: number; value: number }; byDay: Map<string, DaySales>; controllerDays: number; shiftDays: number }>();
  for (const s of stations) {
    const fromController = actualFromController.get(s.id)?.byDay;
    const fromShifts = approved.get(s.id)?.byDay;
    const merged = { products: emptyProducts(), unmapped: { liters: 0, value: 0 }, byDay: new Map<string, DaySales>(), controllerDays: 0, shiftDays: 0 };
    for (const day of daysOf(range)) {
      const c = fromController?.get(day);
      const sh = fromShifts?.get(day);
      const t: DaySales | undefined = c ?? (sh && { ...sh, unmapped: { liters: 0, value: 0 } });
      if (!t) continue;
      if (c) merged.controllerDays += 1; else merged.shiftDays += 1;
      merged.byDay.set(day, t);
      for (const p of PRODUCTS) {
        merged.products[p].liters = round(merged.products[p].liters + t[p].liters, 3);
        merged.products[p].value = round(merged.products[p].value + t[p].value);
      }
      merged.unmapped.liters = round(merged.unmapped.liters + t.unmapped.liters, 3);
      merged.unmapped.value = round(merged.unmapped.value + t.unmapped.value);
    }
    sales.set(s.id, merged);
  }
  const now = new Date();
  const rows = stations.map((s) => {
    const sale = sales.get(s.id)!;
    const products = sale.products;
    const fromShifts = approved.get(s.id);
    const controller = controllers.find((c) => c.costCenterId === s.id);
    const ownTanks = tanks.filter((t) => t.costCenterId === s.id);
    const ownDeliveries = deliveries.filter((x) => x.costCenterId === s.id);
    const count = (statuses: readonly string[]) => pending.filter((p) => p.costCenterId === s.id && statuses.includes(p.status)).reduce((n, p) => n + p._count._all, 0);
    return {
      costCenterId: s.id,
      name: s.name,
      liters: round(dayLiters(products) + sale.unmapped.liters, 3),
      value: round(dayValue(products) + sale.unmapped.value),
      products,
      unmapped: sale.unmapped,
      // مصدر المبيعات: controller (كل الأيام من الجهاز) / shifts / mixed / none
      source: sale.controllerDays && sale.shiftDays ? "mixed" : sale.controllerDays ? "controller" : sale.shiftDays ? "shifts" : "none",
      controllerTransactions: actualFromController.get(s.id)?.count ?? 0,
      approved: {
        liters: round(fromShifts ? dayLiters(fromShifts.products) : 0, 3),
        value: round(fromShifts ? dayValue(fromShifts.products) : 0),
        shifts: fromShifts?.shiftIds.size ?? 0,
      },
      shifts: fromShifts?.shiftIds.size ?? 0,
      awaitingReview: count(AWAITING_REVIEW),
      awaitingPost: count(["approved"]),
      collections: cash.get(s.id) ?? { cash: 0, network: 0, fuelCard: 0 },
      today: live.byStation.get(s.id) ?? null,
      controller: controller ? { id: controller.id, health: controllerHealth(controller, now), lastSeenAt: controller.lastSeenAt } : null,
      tanks: ownTanks,
      lowTanks: ownTanks.filter((t) => t.low).length,
      deliveries: { count: ownDeliveries.length, liters: round(ownDeliveries.reduce((n, x) => n + x.lines.reduce((m, l) => m + Number(l.receivedLiters), 0), 0), 3) },
      alerts7d: alerts.filter((a) => a.controller.costCenterId === s.id).length,
    };
  });
  return { rows, sales, alerts, unpriced };
}

/** نظرة كل المحطات: إجماليات، ملخص لكل محطة، واتجاه يومي (لترات وقيمة) لكل محطة. */
export async function getStationsOverview(tenantId: string, companyId: string, range: DashboardRange) {
  assertRange(range);
  const stations = await loadStations(tenantId, companyId);
  const { rows, sales, unpriced } = await stationSummaries(tenantId, companyId, stations, range);
  const daily = daysOf(range).map((day) => {
    const point: Record<string, number | string> = { day, liters: 0, value: 0 };
    for (const s of stations) {
      const t = sales.get(s.id)?.byDay.get(day);
      const liters = t ? dayLiters(t) : 0;
      const value = t ? dayValue(t) : 0;
      point[s.id] = round(liters, 3);
      point.liters = round(Number(point.liters) + liters, 3);
      point.value = round(Number(point.value) + value);
    }
    return point;
  });
  const sum = (fn: (r: (typeof rows)[number]) => number, places = 2) => round(rows.reduce((n, r) => n + fn(r), 0), places);
  const products = emptyProducts();
  for (const r of rows) for (const p of PRODUCTS) {
    products[p].liters = round(products[p].liters + r.products[p].liters, 3);
    products[p].value = round(products[p].value + r.products[p].value);
  }
  return {
    from: range.from, to: range.to,
    totals: {
      liters: sum((r) => r.liters, 3), value: sum((r) => r.value), shifts: sum((r) => r.shifts, 0),
      controllerTransactions: sum((r) => r.controllerTransactions, 0),
      approvedLiters: sum((r) => r.approved.liters, 3), approvedValue: sum((r) => r.approved.value),
      cash: sum((r) => r.collections.cash), network: sum((r) => r.collections.network), fuelCard: sum((r) => r.collections.fuelCard),
      awaitingReview: sum((r) => r.awaitingReview, 0), awaitingPost: sum((r) => r.awaitingPost, 0), lowTanks: sum((r) => r.lowTanks, 0),
      todayLiters: sum((r) => r.today?.liters ?? 0, 3), todayAmount: sum((r) => r.today?.amount ?? 0), products,
    },
    stations: rows, daily, unpricedReadings: unpriced,
  };
}

/** صفحة محطة واحدة: ملخصها، اتجاه يومي حسب المنتج، مبيعات اليوم بالساعة من المتحكم، منحنى كل خزان، الورديات، التوريدات، التنبيهات. */
export async function getStationDetail(tenantId: string, companyId: string, costCenterId: string, range: DashboardRange) {
  assertRange(range);
  const stations = await loadStations(tenantId, companyId, costCenterId);
  const station = stations[0];
  const { rows, sales, alerts, unpriced } = await stationSummaries(tenantId, companyId, stations, range);
  const byDay = sales.get(station.id)?.byDay;
  const daily = daysOf(range).map((day) => {
    const t = byDay?.get(day) ?? emptyProducts();
    return { day, ...Object.fromEntries(PRODUCTS.map((p) => [p, t[p].liters])), value: round(dayValue(t)) };
  });

  const [shifts, deliveries, readings] = await Promise.all([
    prisma.stationShift.findMany({
      where: { tenantId, companyId, costCenterId: station.id, isSeedData: false, shiftDate: { gte: dayStart(range.from), lte: dayStart(range.to) } },
      include: { employee: { select: { name: true } }, collection: true },
      orderBy: [{ shiftDate: "desc" }, { openedAt: "desc" }],
      take: 200,
    }),
    prisma.fuelDelivery.findMany({
      where: { tenantId, companyId, costCenterId: station.id, status: "confirmed", deliveredAt: { gte: riyadhDayStartUtc(range.from), lt: riyadhDayEndExclusiveUtc(range.to) } },
      include: { lines: { include: { tank: { select: { code: true, product: true } } } } },
      orderBy: { deliveredAt: "desc" },
    }),
    prisma.tankReading.findMany({
      where: { tenantId, companyId, voidedAt: null, tank: { costCenterId: station.id }, readAt: { gte: riyadhDayStartUtc(range.from), lt: riyadhDayEndExclusiveUtc(range.to) } },
      select: { tankId: true, readAt: true, liters: true, source: true, purpose: true },
      orderBy: { readAt: "asc" },
      take: 5000,
    }),
  ]);

  return {
    from: range.from, to: range.to,
    station: rows[0],
    daily,
    tankSeries: rows[0].tanks.map((t) => ({
      tankId: t.tankId, code: t.code, product: t.product, capacityLiters: t.capacityLiters,
      points: readings.filter((r) => r.tankId === t.tankId).map((r) => ({ at: r.readAt, liters: Number(r.liters), source: r.source, purpose: r.purpose })),
    })),
    shifts: shifts.map((s) => ({
      id: s.id, shiftDate: shiftDay(s.shiftDate), shiftType: s.shiftType, status: s.status, employee: s.employee?.name ?? null,
      cash: s.collection ? Number(s.collection.cashDelivered) : null, network: s.collection ? Number(s.collection.networkAmount) : null,
    })),
    deliveries: deliveries.map((x) => ({
      id: x.id, deliveredAt: x.deliveredAt, deliveryNoteNumber: x.deliveryNoteNumber,
      lines: x.lines.map((l) => ({ tank: l.tank.code, product: l.tank.product, noteLiters: Number(l.noteLiters), receivedLiters: Number(l.receivedLiters) })),
    })),
    alerts: alerts.slice(0, 50).map((a) => ({ id: a.id, occurredAt: a.occurredAt, deviceType: a.deviceType, deviceNumber: a.deviceNumber, name: a.name, code: a.code, state: a.state })),
    unpricedReadings: unpriced,
  };
}
