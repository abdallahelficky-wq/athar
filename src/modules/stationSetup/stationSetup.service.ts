import { Prisma, StationFuelProduct, StationMeterType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import { FUEL_PRODUCT_LABEL_AR } from "../stationShifts/stationShifts.service";

/**
 * إعداد المحطات: المضخات وفوهاتها، وأسعار الوقود. كان هذا مستحيلاً من التطبيق كلياً (سكريبتات بذر
 * محلية فقط)، فلا يستطيع أي مستأجر محطات جديد إكمال وردية واحدة.
 */

export type PumpType = "petrol" | "diesel";

/** المضخة فوهتان بالضبط، ونوع وقود كل فوهة يتحدد بنوع المضخة — لا يُقبَل من الطلب إطلاقاً */
export const NOZZLE_PRODUCTS: Record<PumpType, [StationFuelProduct, StationFuelProduct]> = {
  petrol: ["gasoline_91", "gasoline_95"],
  diesel: ["diesel", "diesel"],
};

const capacityOf = (digits: number) => new Prisma.Decimal(10).pow(digits);

async function assertStation(tenantId: string, companyId: string, costCenterId: string) {
  const station = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId, companyId } });
  if (!station) throw badRequest("المحطة غير موجودة ضمن هذه الشركة");
  return station;
}

export async function listStationsWithPumps(tenantId: string, companyId: string) {
  const [stations, nozzles] = await Promise.all([
    prisma.costCenter.findMany({ where: { tenantId, companyId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.stationNozzle.findMany({
      where: { tenantId, companyId, isActive: true },
      orderBy: [{ pumpNumber: "asc" }, { nozzleNumber: "asc" }],
      include: { _count: { select: { readings: true } } },
    }),
  ]);
  return stations.map((station) => {
    const pumps = new Map<number, typeof nozzles>();
    for (const n of nozzles.filter((x) => x.costCenterId === station.id)) {
      pumps.set(n.pumpNumber, [...(pumps.get(n.pumpNumber) ?? []), n]);
    }
    return {
      ...station,
      pumps: [...pumps].map(([pumpNumber, list]) => ({
        pumpNumber,
        pumpType: (list.some((n) => n.product === "diesel") ? "diesel" : "petrol") as PumpType,
        meterType: list[0].meterType,
        nozzles: list.map((n) => ({
          id: n.id,
          nozzleNumber: n.nozzleNumber,
          product: n.product,
          meterDigits: n.meterDigits,
          initialReading: n.initialReading,
          hasReadings: n._count.readings > 0,
        })),
      })),
    };
  });
}

export async function createPump(
  tenantId: string,
  input: {
    companyId: string;
    costCenterId: string;
    pumpType: PumpType;
    meterType: StationMeterType;
    hasMoneyMeter: boolean;
    nozzles: [{ meterDigits: number; initialReading: number }, { meterDigits: number; initialReading: number }];
  },
) {
  await assertStation(tenantId, input.companyId, input.costCenterId);
  input.nozzles.forEach((n, i) => {
    if (new Prisma.Decimal(n.initialReading).greaterThanOrEqualTo(capacityOf(n.meterDigits))) {
      throw badRequest(`قراءة الفوهة ${i + 1} الحالية (${n.initialReading}) لا تتسع في عداد من ${n.meterDigits} خانات — تحقّق من عدد الخانات أو القراءة`);
    }
  });

  const products = NOZZLE_PRODUCTS[input.pumpType];
  // رقم المضخة التالي في هذه المحطة (يشمل المضخات الموقوفة: القيد الفريد يغطيها أيضاً). مضختان تُضافان
  // في اللحظة نفسها قد تحصلان على الرقم ذاته — القيد الفريد يرفض الثانية فنعيد المحاولة برقم جديد.
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.stationNozzle.aggregate({ where: { costCenterId: input.costCenterId }, _max: { pumpNumber: true } });
    const pumpNumber = (last._max.pumpNumber ?? 0) + 1;
    try {
      await prisma.$transaction(
        products.map((product, i) =>
          prisma.stationNozzle.create({
            data: {
              tenantId,
              companyId: input.companyId,
              costCenterId: input.costCenterId,
              product,
              pumpNumber,
              nozzleNumber: i + 1,
              meterDigits: input.nozzles[i].meterDigits,
              initialReading: input.nozzles[i].initialReading,
              meterType: input.meterType,
              hasMoneyMeter: input.hasMoneyMeter,
            },
          }),
        ),
      );
      return { pumpNumber };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  throw conflict("تعذّر تخصيص رقم للمضخة، حاول مرة أخرى");
}

export async function updateNozzle(
  tenantId: string,
  companyScope: (companyId: string) => void,
  nozzleId: string,
  input: { meterDigits?: number; initialReading?: number; meterType?: StationMeterType },
) {
  const nozzle = await prisma.stationNozzle.findFirst({ where: { id: nozzleId, tenantId } });
  if (!nozzle) throw notFound("الفوهة غير موجودة");
  companyScope(nozzle.companyId);

  const readings = await prisma.stationShiftReading.findMany({
    where: { nozzleId },
    select: { openingReading: true, closingReading: true, accountantConfirmedValue: true },
  });
  if (input.initialReading !== undefined && readings.length > 0) {
    throw badRequest("لا يمكن تعديل القراءة الأولى لفوهة سُجِّلت عليها ورديات — قراءة الافتتاح تُشتَق الآن من آخر وردية");
  }
  const digits = input.meterDigits ?? nozzle.meterDigits;
  const capacity = capacityOf(digits);
  const initial = new Prisma.Decimal(input.initialReading ?? nozzle.initialReading);
  const recorded = readings.flatMap((r) => [r.openingReading, r.closingReading, r.accountantConfirmedValue]).filter((v): v is Prisma.Decimal => v != null);
  const tooLarge = [initial, ...recorded].find((v) => new Prisma.Decimal(v).greaterThanOrEqualTo(capacity));
  if (tooLarge) {
    throw badRequest(`لا يتسع عداد من ${digits} خانات لقراءة مسجَّلة على هذه الفوهة (${tooLarge.toString()}) — عدد الخانات أقل من الحقيقي`);
  }
  return prisma.stationNozzle.update({ where: { id: nozzleId }, data: input });
}

export async function retirePump(tenantId: string, input: { companyId: string; costCenterId: string; pumpNumber: number }) {
  await assertStation(tenantId, input.companyId, input.costCenterId);
  const result = await prisma.stationNozzle.updateMany({
    where: { tenantId, costCenterId: input.costCenterId, pumpNumber: input.pumpNumber, isActive: true },
    data: { isActive: false },
  });
  if (result.count === 0) throw notFound("المضخة غير موجودة");
  return { retired: result.count };
}

/** منتصف ليل UTC لتاريخ اليوم — نفس أساس StationShift.shiftDate في openShift */
function todayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * سجل أسعار الشركة (السعر العام الذي يسري على كل محطاتها)، مع السعر الساري الآن لكل منتج والسعر
 * المجدول القادم إن وُجد. لا تعديل لأي سعر في مكانه إطلاقاً: الورديات المُرحَّلة قُيِّمت به.
 */
export async function listFuelPrices(tenantId: string, companyId: string) {
  const rows = await prisma.fuelPrice.findMany({
    where: { tenantId, companyId, costCenterId: null },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { id: true, product: true, priceInclVat: true, effectiveFrom: true, createdAt: true },
  });
  const today = todayUtc();
  const current: Partial<Record<StationFuelProduct, string>> = {};
  for (const product of ["gasoline_91", "gasoline_95", "diesel"] as StationFuelProduct[]) {
    const inForce = rows.find((r) => r.product === product && r.effectiveFrom <= today);
    if (inForce) current[product] = inForce.id;
  }
  return rows.map((r) => ({
    ...r,
    status: r.effectiveFrom > today ? "upcoming" : current[r.product] === r.id ? "current" : "past",
  }));
}

export async function createFuelPrice(
  tenantId: string,
  input: { companyId: string; product: StationFuelProduct; priceInclVat: number; effectiveFrom: string },
) {
  const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
  if (Number.isNaN(effectiveFrom.getTime())) throw badRequest("تاريخ السريان غير صالح");

  const duplicate = await prisma.fuelPrice.findFirst({
    where: { tenantId, companyId: input.companyId, costCenterId: null, product: input.product, effectiveFrom },
  });
  if (duplicate) {
    throw conflict(`يوجد سعر لـ ${FUEL_PRODUCT_LABEL_AR[input.product]} بهذا التاريخ بالفعل — الأسعار لا تُعدَّل، أضف سعراً بتاريخ جديد`);
  }

  // سعر بتاريخ يسبق وردية مُرحَّلة (أو في يومها) كان سيغيّر تقييمها بأثر رجعي في التقارير — مرفوض.
  const postedAfter = await prisma.stationShift.findFirst({
    where: { tenantId, companyId: input.companyId, status: "posted", isSeedData: false, shiftDate: { gte: effectiveFrom } },
    orderBy: { shiftDate: "desc" },
    select: { shiftDate: true },
  });
  if (postedAfter) {
    throw badRequest(
      `لا يمكن إضافة سعر بتاريخ ${input.effectiveFrom}: توجد وردية مُرحَّلة بتاريخ ${postedAfter.shiftDate.toISOString().slice(0, 10)} قُيِّمت بالسعر السابق — اختر تاريخاً بعده`,
    );
  }

  return prisma.fuelPrice.create({
    data: { tenantId, companyId: input.companyId, product: input.product, priceInclVat: input.priceInclVat, effectiveFrom, costCenterId: null },
  });
}

/** حذف سعر لم يسرِ بعد فقط (تصحيح إدخال خاطئ لسعر مجدول) — أي سعر سرى يوماً لا يُحذف ولا يُعدَّل */
export async function deleteUpcomingFuelPrice(tenantId: string, companyScope: (companyId: string) => void, id: string) {
  const price = await prisma.fuelPrice.findFirst({ where: { id, tenantId } });
  if (!price) throw notFound("السعر غير موجود");
  companyScope(price.companyId);
  if (price.effectiveFrom <= todayUtc()) {
    throw badRequest("لا يُحذف سعر سرى بالفعل — الورديات قُيِّمت به؛ أضف سعراً جديداً بتاريخ لاحق بدلاً من ذلك");
  }
  await prisma.fuelPrice.delete({ where: { id } });
}
