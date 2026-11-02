import { Prisma, StationFuelProduct, TankReadingPurpose } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { riyadhDayEndExclusiveUtc, riyadhDayStartUtc } from "../../lib/riyadhDate";
import { computeNozzleLiters } from "../stationShifts/stationShifts.service";

/**
 * موديول الخزانات والتوريد — الخزانات تُدار باللتر هنا، والقيمة تبقى في المستودع (حركات المخزون وتكلفة المبيعات عند ترحيل
 * الوردية). المرحلة الأولى: إعداد الخزانات وربط الفوهات بها، قراءات يدوية (قياس العصا)، توريد الوقود، ومطابقة حيّة بلا
 * قيود محاسبية. قراءات الجهاز الآلي (PTS-2) تُكتَب لاحقاً في نفس جدول القراءات بـsource=atg بلا تغيير في البنية.
 *
 * كل استعلام مقيَّد بالمستأجر والشركة؛ الخزان/المحطة/المورد/الفوهة يُتحقَّق أنها من نفس الشركة قبل أي ربط.
 */

/** الورديات التي تدخل مبيعاتها في المطابقة — نفس حالات تقارير الورديات (مُعتمَدة أو مرحَّلة)، وبلا ورديات البذرة. */
const RECONCILED_SHIFT_STATUSES = ["approved", "posted"] as const;

const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

async function assertStation(tenantId: string, companyId: string, costCenterId: string) {
  const station = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId, companyId } });
  if (!station) throw badRequest("المحطة غير موجودة ضمن هذه الشركة");
  return station;
}

async function loadTank(tenantId: string, tankId: string) {
  const tank = await prisma.stationTank.findFirst({ where: { id: tankId, tenantId } });
  if (!tank) throw notFound("الخزان غير موجود");
  return tank;
}

// ===== الخزانات =====

export async function listTanks(tenantId: string, companyId: string) {
  return prisma.stationTank.findMany({
    where: { tenantId, companyId },
    include: { costCenter: { select: { id: true, name: true } }, nozzles: { select: { id: true, pumpNumber: true, nozzleNumber: true, product: true, isActive: true } } },
    orderBy: [{ costCenterId: "asc" }, { code: "asc" }],
  });
}

export interface TankInput {
  companyId: string;
  costCenterId: string;
  code: string;
  product: StationFuelProduct;
  capacityLiters: number;
  atgTankNumber?: number | null;
}

export async function createTank(tenantId: string, input: TankInput) {
  await assertStation(tenantId, input.companyId, input.costCenterId);
  const dup = await prisma.stationTank.findFirst({ where: { costCenterId: input.costCenterId, code: input.code } });
  if (dup) throw badRequest("يوجد خزان بنفس الرقم في هذه المحطة");
  return prisma.stationTank.create({
    data: {
      tenantId, companyId: input.companyId, costCenterId: input.costCenterId, code: input.code.trim(), product: input.product,
      capacityLiters: input.capacityLiters, atgTankNumber: input.atgTankNumber ?? null,
    },
  });
}

export async function updateTank(tenantId: string, tankId: string, input: Partial<Pick<TankInput, "code" | "capacityLiters" | "atgTankNumber">> & { isActive?: boolean }) {
  const tank = await loadTank(tenantId, tankId);
  if (input.code && input.code !== tank.code) {
    const dup = await prisma.stationTank.findFirst({ where: { costCenterId: tank.costCenterId, code: input.code, id: { not: tank.id } } });
    if (dup) throw badRequest("يوجد خزان بنفس الرقم في هذه المحطة");
  }
  return prisma.stationTank.update({
    where: { id: tank.id },
    data: {
      ...(input.code !== undefined ? { code: input.code.trim() } : {}),
      ...(input.capacityLiters !== undefined ? { capacityLiters: input.capacityLiters } : {}),
      ...(input.atgTankNumber !== undefined ? { atgTankNumber: input.atgTankNumber } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** ربط فوهة بخزانها (أو فكّه بـnull): نفس المحطة ونفس المنتج — وإلا تُطرَح مبيعات ديزل من خزان بنزين. */
export async function setNozzleTank(tenantId: string, nozzleId: string, tankId: string | null) {
  const nozzle = await prisma.stationNozzle.findFirst({ where: { id: nozzleId, tenantId } });
  if (!nozzle) throw notFound("الفوهة غير موجودة");
  if (tankId) {
    const tank = await loadTank(tenantId, tankId);
    if (tank.companyId !== nozzle.companyId || tank.costCenterId !== nozzle.costCenterId) throw badRequest("الخزان ليس في نفس محطة الفوهة");
    if (tank.product !== nozzle.product) throw badRequest("منتج الخزان لا يطابق منتج الفوهة");
  }
  return prisma.stationNozzle.update({ where: { id: nozzle.id }, data: { tankId } });
}

// ===== القراءات =====

export interface ReadingInput {
  tankId: string;
  purpose: TankReadingPurpose;
  readAt: Date;
  liters: number;
  heightMm?: number | null;
  waterHeightMm?: number | null;
  waterLiters?: number | null;
  temperatureC?: number | null;
  note?: string;
}

export async function createManualReading(tenantId: string, userId: string, input: ReadingInput) {
  const tank = await loadTank(tenantId, input.tankId);
  if (!tank.isActive) throw badRequest("الخزان موقوف");
  if (d(input.liters).greaterThan(tank.capacityLiters)) throw badRequest("القراءة أكبر من سعة الخزان — تحقّق من القياس أو من سعة الخزان");
  return prisma.tankReading.create({
    data: {
      tenantId, companyId: tank.companyId, tankId: tank.id, source: "manual_dip", purpose: input.purpose, readAt: input.readAt,
      liters: input.liters, heightMm: input.heightMm ?? null, waterHeightMm: input.waterHeightMm ?? null,
      waterLiters: input.waterLiters ?? null, temperatureC: input.temperatureC ?? null, note: input.note, enteredByUserId: userId,
    },
  });
}

export async function listReadings(tenantId: string, companyId: string, filter: { tankId?: string; from?: string; to?: string }) {
  return prisma.tankReading.findMany({
    where: {
      tenantId, companyId,
      ...(filter.tankId ? { tankId: filter.tankId } : {}),
      ...(filter.from || filter.to
        ? { readAt: { ...(filter.from ? { gte: riyadhDayStartUtc(filter.from) } : {}), ...(filter.to ? { lt: riyadhDayEndExclusiveUtc(filter.to) } : {}) } }
        : {}),
    },
    include: { tank: { select: { id: true, code: true, product: true, costCenterId: true } } },
    orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

/** القراءة لا تُحذَف — تُلغى بسبب (تبقى للتدقيق، وتُستبعَد من المطابقة). */
export async function voidReading(tenantId: string, userId: string, readingId: string, reason: string) {
  const why = reason.trim();
  if (!why) throw badRequest("سبب إلغاء القراءة مطلوب");
  const reading = await prisma.tankReading.findFirst({ where: { id: readingId, tenantId } });
  if (!reading) throw notFound("القراءة غير موجودة");
  if (reading.voidedAt) throw badRequest("القراءة ملغاة بالفعل");
  return prisma.tankReading.update({ where: { id: reading.id }, data: { voidedAt: new Date(), voidReason: why, voidedByUserId: userId } });
}

// ===== التوريد =====

export interface DeliveryInput {
  companyId: string;
  costCenterId: string;
  supplierId?: string | null;
  carrierSupplierId?: string | null;
  deliveryNoteNumber: string;
  tankerPlate?: string;
  driverName?: string;
  deliveredAt: Date;
  note?: string;
  lines: { tankId: string; noteLiters: number; receivedLiters: number }[];
}

export async function createDelivery(tenantId: string, userId: string, input: DeliveryInput) {
  await assertStation(tenantId, input.companyId, input.costCenterId);
  if (!input.lines.length) throw badRequest("أضف خزاناً واحداً على الأقل للتوريد");
  for (const supplierId of [input.supplierId, input.carrierSupplierId]) {
    if (!supplierId) continue;
    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId, companyId: input.companyId } });
    if (!supplier) throw badRequest("المورد أو الناقل غير موجود ضمن هذه الشركة");
  }
  const tankIds = [...new Set(input.lines.map((l) => l.tankId))];
  if (tankIds.length !== input.lines.length) throw badRequest("كرّرت نفس الخزان في التوريد — اجمع كميته في سطر واحد");
  const tanks = await prisma.stationTank.findMany({ where: { id: { in: tankIds }, tenantId, companyId: input.companyId, costCenterId: input.costCenterId } });
  if (tanks.length !== tankIds.length) throw badRequest("أحد الخزانات ليس في محطة التوريد");
  const noteNumber = input.deliveryNoteNumber.trim();
  const dup = await prisma.fuelDelivery.findFirst({
    where: { tenantId, companyId: input.companyId, deliveryNoteNumber: noteNumber, status: "confirmed", supplierId: input.supplierId ?? null },
  });
  if (dup) throw badRequest("سند التسليم هذا مسجَّل بالفعل لنفس المورد");

  return prisma.fuelDelivery.create({
    data: {
      tenantId, companyId: input.companyId, costCenterId: input.costCenterId, supplierId: input.supplierId ?? null,
      carrierSupplierId: input.carrierSupplierId ?? null, deliveryNoteNumber: noteNumber, tankerPlate: input.tankerPlate,
      driverName: input.driverName, deliveredAt: input.deliveredAt, note: input.note, createdByUserId: userId,
      lines: { create: input.lines.map((l) => ({ tankId: l.tankId, noteLiters: l.noteLiters, receivedLiters: l.receivedLiters })) },
    },
    include: { lines: true },
  });
}

export async function listDeliveries(tenantId: string, companyId: string, filter: { from?: string; to?: string }) {
  return prisma.fuelDelivery.findMany({
    where: {
      tenantId, companyId,
      ...(filter.from || filter.to
        ? { deliveredAt: { ...(filter.from ? { gte: riyadhDayStartUtc(filter.from) } : {}), ...(filter.to ? { lt: riyadhDayEndExclusiveUtc(filter.to) } : {}) } }
        : {}),
    },
    include: { lines: { include: { tank: { select: { id: true, code: true, product: true } } } }, costCenter: { select: { id: true, name: true } } },
    orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

export async function voidDelivery(tenantId: string, userId: string, deliveryId: string, reason: string) {
  const why = reason.trim();
  if (!why) throw badRequest("سبب إلغاء التوريد مطلوب");
  const delivery = await prisma.fuelDelivery.findFirst({ where: { id: deliveryId, tenantId } });
  if (!delivery) throw notFound("التوريد غير موجود");
  if (delivery.status === "void") throw badRequest("التوريد ملغى بالفعل");
  return prisma.fuelDelivery.update({ where: { id: delivery.id }, data: { status: "void", voidedAt: new Date(), voidReason: why, voidedByUserId: userId } });
}

// ===== المطابقة =====

export type VarianceStatus = "ok" | "warning" | "breach" | "insufficient_readings";

export interface TankReconciliationRow {
  tankId: string;
  code: string;
  product: StationFuelProduct;
  costCenterId: string;
  stationName: string;
  openingReadingId: string | null;
  openingAt: Date | null;
  openingLiters: number | null;
  closingReadingId: string | null;
  closingAt: Date | null;
  closingLiters: number | null;
  receivedLiters: number;
  soldLiters: number;
  expectedLiters: number | null;
  varianceLiters: number | null;
  variancePct: number | null;
  toleranceLiters: number | null;
  status: VarianceStatus;
  shiftsCounted: number;
  deliveriesCounted: number;
}

/**
 * مطابقة كل خزان للفترة [from, to] بأيام الرياض:
 *   الافتتاح = آخر قراءة غير ملغاة قبل بداية الفترة (أو أول قراءة داخلها إن لم توجد قبلها)
 *   الإقفال  = آخر قراءة غير ملغاة حتى نهاية الفترة، بعد الافتتاح
 *   المستلَم = توريدات مؤكَّدة لهذا الخزان بتاريخ في (الافتتاح، الإقفال]
 *   المبيع   = لترات فوهات الخزان في ورديات مُعتمَدة/مرحَّلة (بلا بذرة) أُغلقت في (الافتتاح، الإقفال] — نفس computeNozzleLiters
 *   المتوقع  = الافتتاح + المستلَم − المبيع؛ الفرق = الإقفال − المتوقع (سالب = عجز، موجب = زيادة)
 * السماحية = الأكبر من (نسبة الشركة × المبيع) و(لترات الشركة)؛ ضمنها "سليم"، حتى ضعفها "تنبيه"، وأكثر "مخالفة".
 * لترات الاختبار مستبعدة من المبيع أصلاً (تعود للخزان)، فلا تُعالَج هنا.
 */
export async function reconcile(tenantId: string, companyId: string, range: { from: string; to: string; costCenterId?: string }) {
  if (range.from > range.to) throw badRequest("تاريخ البداية بعد تاريخ النهاية");
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const windowStart = riyadhDayStartUtc(range.from);
  const windowEnd = riyadhDayEndExclusiveUtc(range.to);

  const tanks = await prisma.stationTank.findMany({
    where: { tenantId, companyId, isActive: true, ...(range.costCenterId ? { costCenterId: range.costCenterId } : {}) },
    include: { costCenter: { select: { name: true } } },
    orderBy: [{ costCenterId: "asc" }, { code: "asc" }],
  });

  const rows: TankReconciliationRow[] = [];
  for (const tank of tanks) {
    const base = {
      tankId: tank.id, code: tank.code, product: tank.product, costCenterId: tank.costCenterId, stationName: tank.costCenter.name,
    };
    const live = { tenantId, companyId, tankId: tank.id, voidedAt: null };
    const opening =
      (await prisma.tankReading.findFirst({ where: { ...live, readAt: { lt: windowStart } }, orderBy: [{ readAt: "desc" }, { createdAt: "desc" }] })) ??
      (await prisma.tankReading.findFirst({ where: { ...live, readAt: { gte: windowStart, lt: windowEnd } }, orderBy: [{ readAt: "asc" }, { createdAt: "asc" }] }));
    const closing = opening
      ? await prisma.tankReading.findFirst({ where: { ...live, readAt: { gt: opening.readAt, lt: windowEnd } }, orderBy: [{ readAt: "desc" }, { createdAt: "desc" }] })
      : null;

    if (!opening || !closing) {
      rows.push({
        ...base, openingReadingId: opening?.id ?? null, openingAt: opening?.readAt ?? null, openingLiters: opening ? Number(opening.liters) : null,
        closingReadingId: null, closingAt: null, closingLiters: null, receivedLiters: 0, soldLiters: 0, expectedLiters: null,
        varianceLiters: null, variancePct: null, toleranceLiters: null, status: "insufficient_readings", shiftsCounted: 0, deliveriesCounted: 0,
      });
      continue;
    }

    const deliveryLines = await prisma.fuelDeliveryLine.findMany({
      where: { tankId: tank.id, delivery: { tenantId, companyId, status: "confirmed", deliveredAt: { gt: opening.readAt, lte: closing.readAt } } },
    });
    const received = deliveryLines.reduce((s, l) => s.plus(l.receivedLiters), d(0));

    const shiftReadings = await prisma.stationShiftReading.findMany({
      where: {
        tenantId, companyId, nozzle: { tankId: tank.id },
        shift: { status: { in: [...RECONCILED_SHIFT_STATUSES] }, isSeedData: false, costCenterId: tank.costCenterId, closedAt: { gt: opening.readAt, lte: closing.readAt } },
      },
      include: { nozzle: true },
    });
    let sold = d(0);
    const shiftIds = new Set<string>();
    for (const r of shiftReadings) {
      const closingValue = r.accountantConfirmedValue ?? r.closingReading;
      if (closingValue == null) throw badRequest("قراءة بلا قيمة مؤكَّدة ضمن وردية معتمَدة/مرحَّلة — تحقّق من اتساق البيانات");
      sold = sold.plus(computeNozzleLiters({
        nozzleId: r.nozzleId, product: r.nozzle.product, meterDigits: r.nozzle.meterDigits,
        openingReading: r.openingReading, closingReading: closingValue, testLiters: r.testLiters,
      }));
      shiftIds.add(r.shiftId);
    }

    const expected = d(opening.liters).plus(received).minus(sold);
    const variance = d(closing.liters).minus(expected);
    const tolerance = Prisma.Decimal.max(sold.times(company.tankVariancePctTolerance).dividedBy(100), d(company.tankVarianceLitersTolerance));
    const abs = variance.abs();
    const status: VarianceStatus = abs.lessThanOrEqualTo(tolerance) ? "ok" : abs.lessThanOrEqualTo(tolerance.times(2)) ? "warning" : "breach";

    rows.push({
      ...base,
      openingReadingId: opening.id, openingAt: opening.readAt, openingLiters: Number(opening.liters),
      closingReadingId: closing.id, closingAt: closing.readAt, closingLiters: Number(closing.liters),
      receivedLiters: received.toNumber(), soldLiters: sold.toNumber(), expectedLiters: expected.toNumber(),
      varianceLiters: variance.toDecimalPlaces(3).toNumber(),
      variancePct: sold.greaterThan(0) ? variance.dividedBy(sold).times(100).toDecimalPlaces(3).toNumber() : null,
      toleranceLiters: tolerance.toDecimalPlaces(3).toNumber(), status,
      shiftsCounted: shiftIds.size, deliveriesCounted: new Set(deliveryLines.map((l) => l.deliveryId)).size,
    });
  }

  // مبيعات فوهات غير مربوطة بخزان في الفترة — تُعرَض حتى لا تختفي من المطابقة بصمت
  const unassignedNozzles = await prisma.stationNozzle.count({
    where: { tenantId, companyId, tankId: null, isActive: true, ...(range.costCenterId ? { costCenterId: range.costCenterId } : {}) },
  });
  return { from: range.from, to: range.to, rows, unassignedNozzles };
}
