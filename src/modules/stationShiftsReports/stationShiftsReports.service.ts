import { vatRatePercentOf } from "../../lib/companyVat";
import { Prisma, StationFuelProduct, StationShiftStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import {
  computeNozzleLiters,
  resolveEffectivePrice,
  computeShiftClosing,
  resolveShiftClosingAccounts,
  VAT_DIVISOR,
  type FuelPriceInput,
  type CreditSaleInput,
  type ShiftClosingInput,
  type NozzleReadingInput,
  syncControllerShiftReadings,
  controllerShiftSales,
  controllerDataStatus,
} from "../stationShifts/stationShifts.service";

/**
 * وحدة تقارير ورديات المحطات — قراءة فقط، على وحدة stationShifts الجديدة حصراً. لا صلة لها
 * إطلاقاً بوحدة StationSale القديمة (الإدخال اليدوي لمبيعات المحطات) ولا تتحد بياناتها بأي شكل مع
 * هذه التقارير — نطاقان منفصلان تماماً حسب القرار المعتمَد.
 *
 * "approved" و"posted" فقط تُغذّيان أي رقم هنا: open/submitted/under_review أرقامها لم تُراجَع
 * بعد (قد تتغيّر)، وrejected مرفوضة صراحة. "approved" هي أول حالة تضمن اكتمال كل قراءة (راجع
 * approveShift وhasUnconfirmedReading في stationShifts.service.ts) — قبلها computeShiftClosing
 * نفسها قد ترفض الحساب لقراءة ناقصة.
 *
 * وردية البذرة (isSeedData=true من scripts/seed-station-pumps-demo.ts) تُستبعَد من كل استعلام هنا
 * بلا استثناء، بصرف النظر عن حالتها أو تاريخها — راجع تعليق الحقل في schema.prisma.
 */

const REPORTED_STATUSES = ["approved", "posted"] as const;
type ReportedStatus = (typeof REPORTED_STATUSES)[number];

// حد أقصى للمدى الزمني المطلوب لأي تقرير هنا — يمنع طلباً يمسح سنوات من الورديات دفعة واحدة عبر
// كل محطات الشركة، وهو تحديداً ما يجعل حلقة صافي النقدية أدناه (تحسب كل وردية عبر computeShiftClosing)
// عملية محدودة التكلفة دائماً بدل نمو غير محدود.
const MAX_RANGE_DAYS = 366;

export interface ReportRange {
  dateFrom: Date;
  dateTo: Date;
}

export interface StatusSplit<T> {
  combined: T;
  approved: T;
  posted: T;
}

function emptyStatusSplit<T>(zero: () => T): StatusSplit<T> {
  return { combined: zero(), approved: zero(), posted: zero() };
}

function mapStatusSplit<T, U>(split: StatusSplit<T>, fn: (value: T) => U): StatusSplit<U> {
  return { combined: fn(split.combined), approved: fn(split.approved), posted: fn(split.posted) };
}

function assertRangeWithinLimit(range: ReportRange): void {
  if (range.dateFrom.getTime() > range.dateTo.getTime()) {
    throw badRequest("تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه");
  }
  const spanDays = (range.dateTo.getTime() - range.dateFrom.getTime()) / 86_400_000;
  if (spanDays > MAX_RANGE_DAYS) {
    throw badRequest("المدى الزمني المطلوب أطول من الحد الأقصى المسموح لتقارير ورديات المحطات (366 يوماً) — قسّم الطلب لفترات أقصر");
  }
}

/** المحطات (مراكز التكلفة) المشمولة بالتقرير — فقط ما له فوهات فعلياً (لا كل مركز تكلفة في
 * الشركة، فبعضها أقسام محاسبية عامة لا صلة لها بالمحطات). costCenterIds فارغ/غير مُمرَّر يعني كل
 * محطات الشركة معاً؛ مُمرَّر يعني تحديداً هذه المحطات فقط، مع رفض واضح لو تضمّنت معرّفاً لا يخص
 * هذه الشركة (بدل تجاهله بصمت والرجوع لنتيجة تبدو صحيحة لكنها ناقصة). */
async function resolveCostCenters(tenantId: string, companyId: string, costCenterIds?: string[]) {
  if (!costCenterIds || costCenterIds.length === 0) {
    return prisma.costCenter.findMany({ where: { tenantId, companyId, stationNozzles: { some: {} } }, select: { id: true, name: true } });
  }
  const found = await prisma.costCenter.findMany({
    where: { tenantId, companyId, id: { in: costCenterIds } },
    select: { id: true, name: true },
  });
  if (found.length !== new Set(costCenterIds).size) {
    throw badRequest("إحدى المحطات (مراكز التكلفة) المطلوبة غير موجودة ضمن هذه الشركة");
  }
  return found;
}

/** أسعار الشركة كلها مرة واحدة فقط لكل طلب تقرير (لا مرة لكل قراءة/وردية) — resolveEffectivePrice
 * الخالصة نفسها (لا نسخة ثانية) هي من تقرر السعر الساري بعد تصفية هذه القائمة لكل محطة على حدة. */
function bucketPricesByCostCenter(priceRows: FuelPriceInput[]) {
  const general = priceRows.filter((p) => !p.costCenterId);
  const byCostCenter = new Map<string, FuelPriceInput[]>();
  for (const p of priceRows) {
    if (!p.costCenterId) continue;
    const list = byCostCenter.get(p.costCenterId) ?? [];
    list.push(p);
    byCostCenter.set(p.costCenterId, list);
  }
  return { pricesFor: (costCenterId: string) => [...general, ...(byCostCenter.get(costCenterId) ?? [])] };
}

// ---------------------------------------------------------------------------
// 1) حجم المبيعات (لترات) — حسب مضخة / محطة / منتج، مع قيمتها المالية بنفس مصدر التسعير تماماً
// ---------------------------------------------------------------------------

export type SalesVolumeGroupBy = "pump" | "station" | "product";

export interface SalesVolumeRow {
  costCenterId?: string;
  costCenterName?: string;
  pumpNumber?: number;
  product?: StationFuelProduct;
  liters: number;
  salesValueExclVat: number;
  salesValueInclVat: number;
}

export interface SalesVolumeTotals {
  liters: number;
  salesValueExclVat: number;
  salesValueInclVat: number;
}

export interface SalesVolumeReport {
  groupBy: SalesVolumeGroupBy;
  rows: SalesVolumeRow[];
  totals: StatusSplit<SalesVolumeTotals>;
}

interface DecimalTotals {
  liters: Prisma.Decimal;
  exclVat: Prisma.Decimal;
  inclVat: Prisma.Decimal;
}
const zeroDecimalTotals = (): DecimalTotals => ({ liters: new Prisma.Decimal(0), exclVat: new Prisma.Decimal(0), inclVat: new Prisma.Decimal(0) });
const toSalesVolumeTotals = (t: DecimalTotals): SalesVolumeTotals => ({
  liters: t.liters.toNumber(),
  salesValueExclVat: t.exclVat.toNumber(),
  salesValueInclVat: t.inclVat.toNumber(),
});

const PRODUCT_ORDER: StationFuelProduct[] = ["diesel", "gasoline_91", "gasoline_95"];

function salesVolumeGroupKey(groupBy: SalesVolumeGroupBy, costCenterId: string, pumpNumber: number, product: StationFuelProduct): string {
  if (groupBy === "product") return product;
  if (groupBy === "pump") return `${costCenterId}::${pumpNumber}`;
  return costCenterId;
}

export async function getSalesVolumeReport(
  tenantId: string,
  companyId: string,
  groupBy: SalesVolumeGroupBy,
  range: ReportRange,
  costCenterIds?: string[],
): Promise<SalesVolumeReport> {
  assertRangeWithinLimit(range);
  const costCenters = await resolveCostCenters(tenantId, companyId, costCenterIds);
  const costCenterNameById = new Map(costCenters.map((c) => [c.id, c.name]));
  const ids = costCenters.map((c) => c.id);

  const emptyTotals = emptyStatusSplit(zeroDecimalTotals);
  if (ids.length === 0) {
    return { groupBy, rows: [], totals: mapStatusSplit(emptyTotals, toSalesVolumeTotals) };
  }

  const [readings, priceRows] = await Promise.all([
    prisma.stationShiftReading.findMany({
      where: {
        tenantId,
        companyId,
        shift: { status: { in: [...REPORTED_STATUSES] }, isSeedData: false, shiftDate: { gte: range.dateFrom, lte: range.dateTo }, costCenterId: { in: ids } },
      },
      include: { nozzle: true, shift: { select: { status: true, shiftDate: true, costCenterId: true } } },
    }),
    prisma.fuelPrice.findMany({ where: { tenantId, companyId } }),
  ]);
  const { pricesFor } = bucketPricesByCostCenter(priceRows);

  const rowsByKey = new Map<string, DecimalTotals & { costCenterId: string; pumpNumber: number; product: StationFuelProduct }>();
  const totals = emptyStatusSplit(zeroDecimalTotals);

  for (const reading of readings) {
    const closingValue = reading.accountantConfirmedValue ?? reading.closingReading;
    if (closingValue == null) {
      // مستحيل عملياً لوردية approved/posted (راجع hasUnconfirmedReading في approveShift) — خطأ
      // اتساق بيانات لو حدث فعلاً، لا يُبتلَع بصمت كرقم ناقص في التقرير.
      console.error(`stationShiftsReports: قراءة بلا قيمة مؤكَّدة ضمن وردية approved/posted — shiftId=${reading.shiftId}`);
      throw badRequest("قراءة بلا قيمة مؤكَّدة ضمن وردية معتمَدة/مرحَّلة — تحقّق من اتساق البيانات");
    }
    const liters = computeNozzleLiters({
      nozzleId: reading.nozzleId,
      product: reading.nozzle.product,
      meterDigits: reading.nozzle.meterDigits,
      openingReading: reading.openingReading,
      closingReading: closingValue,
      testLiters: reading.testLiters,
    });
    const priceInclVat = resolveEffectivePrice(reading.nozzle.product, reading.shift.shiftDate, pricesFor(reading.shift.costCenterId));
    const inclVat = liters.times(priceInclVat).toDecimalPlaces(2);
    const exclVat = inclVat.dividedBy(VAT_DIVISOR).toDecimalPlaces(2);

    const key = salesVolumeGroupKey(groupBy, reading.shift.costCenterId, reading.nozzle.pumpNumber, reading.nozzle.product);
    const row = rowsByKey.get(key) ?? { ...zeroDecimalTotals(), costCenterId: reading.shift.costCenterId, pumpNumber: reading.nozzle.pumpNumber, product: reading.nozzle.product };
    row.liters = row.liters.plus(liters);
    row.exclVat = row.exclVat.plus(exclVat);
    row.inclVat = row.inclVat.plus(inclVat);
    rowsByKey.set(key, row);

    const status = reading.shift.status as ReportedStatus;
    for (const bucket of [totals.combined, totals[status]]) {
      bucket.liters = bucket.liters.plus(liters);
      bucket.exclVat = bucket.exclVat.plus(exclVat);
      bucket.inclVat = bucket.inclVat.plus(inclVat);
    }
  }

  const rows: SalesVolumeRow[] = [...rowsByKey.values()].map((r) => ({
    ...(groupBy !== "product" ? { costCenterId: r.costCenterId, costCenterName: costCenterNameById.get(r.costCenterId) } : {}),
    ...(groupBy === "pump" ? { pumpNumber: r.pumpNumber } : {}),
    ...(groupBy === "product" ? { product: r.product } : {}),
    liters: r.liters.toNumber(),
    salesValueExclVat: r.exclVat.toNumber(),
    salesValueInclVat: r.inclVat.toNumber(),
  }));

  rows.sort((a, b) => {
    if (groupBy === "product") return PRODUCT_ORDER.indexOf(a.product!) - PRODUCT_ORDER.indexOf(b.product!);
    const byName = (a.costCenterName ?? "").localeCompare(b.costCenterName ?? "");
    if (byName !== 0 || groupBy !== "pump") return byName;
    return (a.pumpNumber ?? 0) - (b.pumpNumber ?? 0);
  });

  return { groupBy, rows, totals: mapStatusSplit(totals, toSalesVolumeTotals) };
}

// ---------------------------------------------------------------------------
// 2) ملخص النقدية اليومي — إجمالي النقد المُسلَّم، وإجمالي "البنك" (شبكة + بطاقات وقود مجموعين)
// ---------------------------------------------------------------------------

export interface CashSummaryDayRow {
  date: string;
  totalCash: number;
  networkAmount: number;
  fuelCardAmount: number;
  bankTotal: number;
}
export interface CashSummaryTotals {
  totalCash: number;
  networkAmount: number;
  fuelCardAmount: number;
  bankTotal: number;
}
export interface CashSummaryReport {
  daily: CashSummaryDayRow[];
  totals: StatusSplit<CashSummaryTotals>;
}

interface CashDecimalTotals {
  cashDelivered: Prisma.Decimal;
  network: Prisma.Decimal;
  fuelCard: Prisma.Decimal;
}
const zeroCashDecimalTotals = (): CashDecimalTotals => ({ cashDelivered: new Prisma.Decimal(0), network: new Prisma.Decimal(0), fuelCard: new Prisma.Decimal(0) });
const toCashSummaryTotals = (t: CashDecimalTotals): CashSummaryTotals => ({
  totalCash: t.cashDelivered.toDecimalPlaces(2).toNumber(),
  networkAmount: t.network.toDecimalPlaces(2).toNumber(),
  fuelCardAmount: t.fuelCard.toDecimalPlaces(2).toNumber(),
  bankTotal: t.network.plus(t.fuelCard).toDecimalPlaces(2).toNumber(),
});

export async function getCashSummaryReport(tenantId: string, companyId: string, range: ReportRange, costCenterIds?: string[]): Promise<CashSummaryReport> {
  assertRangeWithinLimit(range);
  const costCenters = await resolveCostCenters(tenantId, companyId, costCenterIds);
  const ids = costCenters.map((c) => c.id);
  const emptyTotals = emptyStatusSplit(zeroCashDecimalTotals);
  if (ids.length === 0) return { daily: [], totals: mapStatusSplit(emptyTotals, toCashSummaryTotals) };

  const collections = await prisma.stationShiftCollection.findMany({
    where: {
      tenantId,
      companyId,
      shift: { status: { in: [...REPORTED_STATUSES] }, isSeedData: false, shiftDate: { gte: range.dateFrom, lte: range.dateTo }, costCenterId: { in: ids } },
    },
    include: { shift: { select: { status: true, shiftDate: true } } },
  });

  const byDay = new Map<string, CashDecimalTotals>();
  const totals = emptyStatusSplit(zeroCashDecimalTotals);

  for (const c of collections) {
    const dateKey = c.shift.shiftDate.toISOString().slice(0, 10);
    const row = byDay.get(dateKey) ?? zeroCashDecimalTotals();
    row.cashDelivered = row.cashDelivered.plus(c.cashDelivered);
    row.network = row.network.plus(c.networkAmount);
    row.fuelCard = row.fuelCard.plus(c.fuelCardAmount);
    byDay.set(dateKey, row);

    const status = c.shift.status as ReportedStatus;
    for (const bucket of [totals.combined, totals[status]]) {
      bucket.cashDelivered = bucket.cashDelivered.plus(c.cashDelivered);
      bucket.network = bucket.network.plus(c.networkAmount);
      bucket.fuelCard = bucket.fuelCard.plus(c.fuelCardAmount);
    }
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({
      date,
      totalCash: t.cashDelivered.toDecimalPlaces(2).toNumber(),
      networkAmount: t.network.toDecimalPlaces(2).toNumber(),
      fuelCardAmount: t.fuelCard.toDecimalPlaces(2).toNumber(),
      bankTotal: t.network.plus(t.fuelCard).toDecimalPlaces(2).toNumber(),
    }));

  return { daily, totals: mapStatusSplit(totals, toCashSummaryTotals) };
}

// ---------------------------------------------------------------------------
// 3) إجمالي المصروفات
// ---------------------------------------------------------------------------

export interface ExpensesDayRow {
  date: string;
  total: number;
}
export interface ExpensesTotals {
  total: number;
}
export interface ExpensesReport {
  daily: ExpensesDayRow[];
  totals: StatusSplit<ExpensesTotals>;
}

export async function getExpensesReport(tenantId: string, companyId: string, range: ReportRange, costCenterIds?: string[]): Promise<ExpensesReport> {
  assertRangeWithinLimit(range);
  const costCenters = await resolveCostCenters(tenantId, companyId, costCenterIds);
  const ids = costCenters.map((c) => c.id);
  const zero = () => new Prisma.Decimal(0);
  const emptyTotals = emptyStatusSplit(zero);
  if (ids.length === 0) return { daily: [], totals: mapStatusSplit(emptyTotals, (d) => ({ total: d.toNumber() })) };

  const expenses = await prisma.stationShiftExpense.findMany({
    where: {
      tenantId,
      companyId,
      shift: { status: { in: [...REPORTED_STATUSES] }, isSeedData: false, shiftDate: { gte: range.dateFrom, lte: range.dateTo }, costCenterId: { in: ids } },
    },
    include: { shift: { select: { status: true, shiftDate: true } } },
  });

  const byDay = new Map<string, Prisma.Decimal>();
  const totals = emptyStatusSplit(zero);

  for (const e of expenses) {
    const dateKey = e.shift.shiftDate.toISOString().slice(0, 10);
    byDay.set(dateKey, (byDay.get(dateKey) ?? new Prisma.Decimal(0)).plus(e.amount));
    const status = e.shift.status as ReportedStatus;
    totals.combined = totals.combined.plus(e.amount);
    totals[status] = totals[status].plus(e.amount);
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total: total.toDecimalPlaces(2).toNumber() }));

  return { daily, totals: mapStatusSplit(totals, (d) => ({ total: d.toDecimalPlaces(2).toNumber() })) };
}

// ---------------------------------------------------------------------------
// 4) صافي النقدية — حسّاس، مقصور على صلاحية المحاسب/المراجع (راجع stationShiftsReports.routes.ts)
// ---------------------------------------------------------------------------

export interface NetCashMetrics {
  expectedCash: number;
  expensesTotal: number;
  cashDue: number;
  cashDelivered: number;
  /** مجموع أيام العجز فقط، كقيمة موجبة دائماً — لا يُطرَح من الفائض إطلاقاً (راجع تعليق أدناه). */
  shortageTotal: number;
  /** مجموع أيام الزيادة فقط. */
  surplusTotal: number;
  /** المجموع الجبري (الموجَّه) للفرق — لأغراض الاكتمال فقط؛ لا يُستخدَم وحده كمؤشر لأن عجزاً
   * وزيادة متساويين في شهر واحد يُظهِرانه صفراً رغم وجود مشكلتين منفصلتين تحتاجان معالجة. */
  netVariance: number;
}
export interface NetCashDayRow extends NetCashMetrics {
  date: string;
}
export interface NetCashStationRow extends NetCashMetrics {
  costCenterId: string;
  costCenterName: string;
}
export interface NetCashReport {
  daily: NetCashDayRow[];
  byStation: NetCashStationRow[];
  totals: StatusSplit<NetCashMetrics>;
}

interface NetCashDecimalTotals {
  expectedCash: Prisma.Decimal;
  expensesTotal: Prisma.Decimal;
  cashDue: Prisma.Decimal;
  cashDelivered: Prisma.Decimal;
  shortageTotal: Prisma.Decimal;
  surplusTotal: Prisma.Decimal;
  netVariance: Prisma.Decimal;
}
const zeroNetCashDecimalTotals = (): NetCashDecimalTotals => ({
  expectedCash: new Prisma.Decimal(0),
  expensesTotal: new Prisma.Decimal(0),
  cashDue: new Prisma.Decimal(0),
  cashDelivered: new Prisma.Decimal(0),
  shortageTotal: new Prisma.Decimal(0),
  surplusTotal: new Prisma.Decimal(0),
  netVariance: new Prisma.Decimal(0),
});
const toNetCashMetrics = (t: NetCashDecimalTotals): NetCashMetrics => ({
  expectedCash: t.expectedCash.toNumber(),
  expensesTotal: t.expensesTotal.toNumber(),
  cashDue: t.cashDue.toNumber(),
  cashDelivered: t.cashDelivered.toNumber(),
  shortageTotal: t.shortageTotal.toNumber(),
  surplusTotal: t.surplusTotal.toNumber(),
  netVariance: t.netVariance.toNumber(),
});

function accumulateNetCash(
  target: NetCashDecimalTotals,
  perShift: { expectedCash: Prisma.Decimal; expensesTotal: Prisma.Decimal; cashDue: Prisma.Decimal; cashDelivered: Prisma.Decimal; variance: Prisma.Decimal },
) {
  target.expectedCash = target.expectedCash.plus(perShift.expectedCash);
  target.expensesTotal = target.expensesTotal.plus(perShift.expensesTotal);
  target.cashDue = target.cashDue.plus(perShift.cashDue);
  target.cashDelivered = target.cashDelivered.plus(perShift.cashDelivered);
  target.netVariance = target.netVariance.plus(perShift.variance);
  // العجز والزيادة يُجمَعان كل على حدة، بلا مقاصة بينهما — راجع تعليق NetCashMetrics.shortageTotal.
  if (perShift.variance.isNegative()) target.shortageTotal = target.shortageTotal.plus(perShift.variance.abs());
  else target.surplusTotal = target.surplusTotal.plus(perShift.variance);
}

/**
 * صافي النقدية عبر مدى تواريخ/عدة محطات دفعة واحدة — لا تستدعي loadShiftClosingInput ذات الوردية
 * الواحدة في stationShifts.service.ts (تلك مصمَّمة لاستعلام واحد في كل مرة، بما فيها 8 استعلامات
 * getAccountIdByName منفصلة عبر resolveShiftClosingAccounts في كل استدعاء — مقبول لوردية واحدة،
 * مكلف جداً لو تكرر لكل وردية داخل حلقة تقرير كامل). بدلاً من ذلك: تُحلّ حسابات الشركة مرة واحدة
 * فقط لكل طلب تقرير، وتُجلَب كل الورديات المطابقة والأسعار والعملاء المرتبطين ببيع آجل بثلاث
 * استعلامات دفعة واحدة (لا استعلام لكل وردية)، ثم تُبنى مدخلات computeShiftClosing الخالصة نفسها
 * من هذه البيانات المُحمَّلة مسبقاً في الذاكرة فقط — العدد الكلي للاستعلامات ثابت بصرف النظر عن
 * عدد الورديات المطابقة، لا يتناسب معه.
 */
export async function getNetCashReport(tenantId: string, companyId: string, range: ReportRange, costCenterIds?: string[]): Promise<NetCashReport> {
  assertRangeWithinLimit(range);
  const costCenters = await resolveCostCenters(tenantId, companyId, costCenterIds);
  const costCenterNameById = new Map(costCenters.map((c) => [c.id, c.name]));
  const ids = costCenters.map((c) => c.id);

  const emptyTotals = emptyStatusSplit(zeroNetCashDecimalTotals);
  if (ids.length === 0) return { daily: [], byStation: [], totals: mapStatusSplit(emptyTotals, toNetCashMetrics) };

  const { accounts, expenseAccountId } = await resolveShiftClosingAccounts(tenantId, companyId);

  const [shifts, priceRows] = await Promise.all([
    prisma.stationShift.findMany({
      where: { tenantId, companyId, status: { in: [...REPORTED_STATUSES] }, isSeedData: false, shiftDate: { gte: range.dateFrom, lte: range.dateTo }, costCenterId: { in: ids } },
      include: { readings: { include: { nozzle: true } }, expenses: true, collection: true, creditSales: true, company: { select: { country: true, vatRate: true } } },
    }),
    prisma.fuelPrice.findMany({ where: { tenantId, companyId } }),
  ]);
  const { pricesFor } = bucketPricesByCostCenter(priceRows);

  const customerIds = [...new Set(shifts.flatMap((s) => s.creditSales.map((cs) => cs.customerId)))];
  const customers = customerIds.length ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, accountId: true } }) : [];
  const customerAccountById = new Map(customers.map((c) => [c.id, c.accountId]));

  const byDay = new Map<string, NetCashDecimalTotals>();
  const byStation = new Map<string, NetCashDecimalTotals>();
  const totals = emptyStatusSplit(zeroNetCashDecimalTotals);

  for (const shift of shifts) {
    const readingsInput: NozzleReadingInput[] = shift.readings.map((r) => {
      const closing = r.accountantConfirmedValue ?? r.closingReading;
      if (closing == null) {
        console.error(`stationShiftsReports: قراءة بلا قيمة مؤكَّدة ضمن وردية approved/posted — shiftId=${shift.id}`);
        throw badRequest("قراءة بلا قيمة مؤكَّدة ضمن وردية معتمَدة/مرحَّلة — تحقّق من اتساق البيانات");
      }
      return { nozzleId: r.nozzleId, product: r.nozzle.product, meterDigits: r.nozzle.meterDigits, openingReading: r.openingReading, closingReading: closing, testLiters: r.testLiters };
    });
    const creditSalesInput: CreditSaleInput[] = shift.creditSales.map((cs) => {
      const accountId = customerAccountById.get(cs.customerId);
      if (!accountId) throw badRequest("عميل مرتبط ببيع آجل بلا حساب محاسبي ضمن إحدى الورديات المشمولة بالتقرير — أكمل بياناته أولاً");
      return { customerId: cs.customerId, accountId, amount: cs.amount };
    });

    const input: ShiftClosingInput = {
      costCenterId: shift.costCenterId,
      shiftDate: shift.shiftDate,
      vatRatePercent: vatRatePercentOf(shift.company),
      readings: readingsInput,
      prices: pricesFor(shift.costCenterId),
      networkAmount: shift.collection?.networkAmount ?? 0,
      fuelCardAmount: shift.collection?.fuelCardAmount ?? 0,
      cashDelivered: shift.collection?.cashDelivered ?? 0,
      creditSales: creditSalesInput,
      expenses: shift.expenses.map((e) => ({ accountId: expenseAccountId, amount: e.amount })),
      accounts,
    };

    const result = computeShiftClosing(input);
    const cashDelivered = new Prisma.Decimal(input.cashDelivered);
    const perShift = { expectedCash: result.expectedCash, expensesTotal: result.expensesTotal, cashDue: result.cashDue, cashDelivered, variance: result.variance };

    const dateKey = shift.shiftDate.toISOString().slice(0, 10);
    if (!byDay.has(dateKey)) byDay.set(dateKey, zeroNetCashDecimalTotals());
    if (!byStation.has(shift.costCenterId)) byStation.set(shift.costCenterId, zeroNetCashDecimalTotals());
    accumulateNetCash(byDay.get(dateKey)!, perShift);
    accumulateNetCash(byStation.get(shift.costCenterId)!, perShift);

    const status = shift.status as ReportedStatus;
    accumulateNetCash(totals.combined, perShift);
    accumulateNetCash(totals[status], perShift);
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, ...toNetCashMetrics(t) }));
  const byStationRows = [...byStation.entries()]
    .map(([costCenterId, t]) => ({ costCenterId, costCenterName: costCenterNameById.get(costCenterId) ?? costCenterId, ...toNetCashMetrics(t) }))
    .sort((a, b) => a.costCenterName.localeCompare(b.costCenterName));

  return { daily, byStation: byStationRows, totals: mapStatusSplit(totals, toNetCashMetrics) };
}

// ---------------------------------------------------------------------------
// 5) استثناءات بيانات البذرة — قائمة تدقيق فقط: كل وردية isSeedData=true فعلياً موجودة على هذه
// الشركة، بصرف النظر عن حالتها أو تاريخها. الوجود المثالي في بيئة إنتاجية هو صفر دائماً؛ أي صف هنا
// معناه إما تشغيل سكريبت بذرة (scripts/seed-station-pumps-demo.ts) بالخطأ على قاعدة حقيقية، أو
// محاولة تلاعب بهذا الحقل من مكان لم يُدقَّق بعد — يُوضَع خلف نفس صلاحية صافي النقدية عمداً
// (راجع stationShiftsReports.routes.ts)، لا لأنه رقم مالي حسّاس بذاته، بل لأنه أداة تدقيق مباشرة
// لسلامة كل تقرير آخر في هذه الوحدة.
// ---------------------------------------------------------------------------

export interface SeedDataExceptionRow {
  id: string;
  costCenterId: string;
  costCenterName: string;
  shiftDate: Date;
  status: StationShiftStatus;
}

export async function getSeedDataExceptionsReport(tenantId: string, companyId: string): Promise<SeedDataExceptionRow[]> {
  const shifts = await prisma.stationShift.findMany({
    where: { tenantId, companyId, isSeedData: true },
    select: { id: true, shiftDate: true, status: true, costCenter: { select: { id: true, name: true } } },
    orderBy: { shiftDate: "desc" },
  });
  return shifts.map((s) => ({ id: s.id, costCenterId: s.costCenter.id, costCenterName: s.costCenter.name, shiftDate: s.shiftDate, status: s.status }));
}

// ---------------------------------------------------------------------------
// تقرير الورديات اليومي — لكل يوم ومحطة: الوردية الصباحية والمسائية وإجمالي اليوم
// ---------------------------------------------------------------------------

/**
 * خلافاً لبقية تقارير هذا الملف (المعتمد/المرحَّل فقط)، هذا التقرير تشغيلي: يعرض كل وردية غير مرفوضة ولا معكوسة بحالتها
 * (مفتوحة/مرسلة/قيد المراجعة/معتمدة/مرحَّلة) حتى يرى المدير بيع اليوم قبل المراجعة — والحالة ظاهرة مع كل وردية، فالرقم غير
 * المعتمد واضح أنه غير نهائي. الوردية الآلية غير المعتمدة تُزامَن أولاً مع ما وصل متأخراً من المتحكم (syncControllerShiftReadings)
 * والمفتوحة تُحسب حتى اللحظة من عدادات المتحكم. وردية مصوَّرة لم يراجع المحاسب كل قراءاتها: مبيعاتها null (complete=false).
 * المبلغ = اللترات × السعر الساري للمحطة يوم الوردية (resolveEffectivePrice — نفس سعر القيد). الفرق = التحصيل (شبكة + بطاقات
 * + نقد + آجل + مصروفات) − المبيعات: موجب زيادة، سالب عجز. كل شيء مقيَّد بالمستأجر والشركة ومحطاتها.
 */
const SHIFT_REPORT_STATUSES = ["open", "submitted", "under_review", "approved", "posted"] as const;
const PRODUCTS: StationFuelProduct[] = ["gasoline_91", "gasoline_95", "diesel"];
type Money = number;

export interface ShiftReportCell {
  id: string;
  shiftType: "morning" | "night";
  status: StationShiftStatus;
  worker: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  readingsSource: string;
  complete: boolean;
  /** وردية آلية مقفلة: هل رفع الجهاز كل عملياته حتى وقت إقفالها (controllerDataStatus)؛ null لغير الآلية أو المفتوحة. */
  deviceDataComplete: boolean | null;
  products: Partial<Record<StationFuelProduct, { liters: number; amount: Money | null }>>;
  liters: number | null;
  amount: Money | null;
  network: Money;
  fuelCard: Money;
  cash: Money;
  credit: Money;
  expenses: Money;
  collected: Money;
  variance: Money | null;
}

export interface ShiftReportTotals {
  products: Record<StationFuelProduct, { liters: number; amount: Money }>;
  liters: number;
  amount: Money;
  network: Money;
  fuelCard: Money;
  cash: Money;
  credit: Money;
  expenses: Money;
  collected: Money;
  variance: Money;
  shifts: number;
  incompleteShifts: number;
}

export interface ShiftReportDayRow {
  day: string;
  costCenterId: string;
  stationName: string;
  /** عادةً وردية واحدة لكل نوع في اليوم، لكن لا قيد يمنع أكثر (وردية أُعيد فتحها بعد رفض/عكس) — فقائمة لا خانة. */
  morning: ShiftReportCell[];
  night: ShiftReportCell[];
  total: ShiftReportTotals;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
function emptyTotals(): ShiftReportTotals {
  return {
    products: { gasoline_91: { liters: 0, amount: 0 }, gasoline_95: { liters: 0, amount: 0 }, diesel: { liters: 0, amount: 0 } },
    liters: 0, amount: 0, network: 0, fuelCard: 0, cash: 0, credit: 0, expenses: 0, collected: 0, variance: 0, shifts: 0, incompleteShifts: 0,
  };
}
function addCell(t: ShiftReportTotals, c: ShiftReportCell) {
  t.shifts += 1;
  for (const k of ["network", "fuelCard", "cash", "credit", "expenses", "collected"] as const) t[k] = r2(t[k] + c[k]);
  if (!c.complete) { t.incompleteShifts += 1; return; }
  for (const p of PRODUCTS) {
    const v = c.products[p];
    if (!v) continue;
    t.products[p].liters = r3(t.products[p].liters + v.liters);
    t.products[p].amount = r2(t.products[p].amount + (v.amount ?? 0));
  }
  t.liters = r3(t.liters + (c.liters ?? 0));
  t.amount = r2(t.amount + (c.amount ?? 0));
  t.variance = r2(t.variance + (c.variance ?? 0));
}

export async function getShiftsDailyReport(tenantId: string, companyId: string, range: ReportRange, costCenterIds?: string[]) {
  assertRangeWithinLimit(range);
  const stations = await resolveCostCenters(tenantId, companyId, costCenterIds);
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const where = {
    tenantId, companyId, isSeedData: false, costCenterId: { in: stations.map((s) => s.id) },
    shiftDate: { gte: range.dateFrom, lte: range.dateTo }, status: { in: [...SHIFT_REPORT_STATUSES] },
  };
  const pending = await prisma.stationShift.findMany({ where: { ...where, readingsSource: "controller", status: { in: ["open", "submitted", "under_review"] } }, select: { id: true }, orderBy: { openedAt: "asc" } });
  for (const p of pending) await syncControllerShiftReadings(tenantId, p.id);

  const [shifts, priceRows] = await Promise.all([
    prisma.stationShift.findMany({
      where,
      include: { readings: { include: { nozzle: true } }, collection: true, creditSales: true, expenses: true, stationUser: { select: { name: true } } },
      orderBy: [{ shiftDate: "asc" }, { openedAt: "asc" }],
    }),
    prisma.fuelPrice.findMany({ where: { tenantId, companyId } }),
  ]);
  const { pricesFor } = bucketPricesByCostCenter(priceRows);

  const cells: { day: string; costCenterId: string; cell: ShiftReportCell }[] = [];
  for (const sh of shifts) {
    const network = Number(sh.collection?.networkAmount ?? 0);
    const fuelCard = Number(sh.collection?.fuelCardAmount ?? 0);
    const cash = Number(sh.collection?.cashDelivered ?? 0);
    const credit = sh.creditSales.reduce((a, c) => a + Number(c.amount), 0);
    const expenses = sh.expenses.reduce((a, e) => a + Number(e.amount), 0);
    const products: ShiftReportCell["products"] = {};
    let complete = true;
    const priceOf = (p: StationFuelProduct) => {
      try { return resolveEffectivePrice(p, sh.shiftDate, pricesFor(sh.costCenterId)); } catch { return null; }
    };
    if (sh.status === "open" && sh.readingsSource === "controller") {
      const live = await controllerShiftSales(tenantId, sh, sh.readings);
      for (const p of live.products) products[p.product] = { liters: p.liters, amount: p.amount };
    } else {
      const litersBy = new Map<StationFuelProduct, Prisma.Decimal>();
      for (const r of sh.readings) {
        const closing = r.accountantConfirmedValue ?? r.closingReading;
        if (closing == null) { complete = false; break; }
        let liters: Prisma.Decimal;
        try {
          liters = computeNozzleLiters({ nozzleId: r.nozzleId, product: r.nozzle.product, meterDigits: r.nozzle.meterDigits, openingReading: r.openingReading, closingReading: closing, testLiters: r.testLiters } as NozzleReadingInput);
        } catch { complete = false; break; }
        litersBy.set(r.nozzle.product, (litersBy.get(r.nozzle.product) ?? new Prisma.Decimal(0)).plus(liters));
      }
      if (complete) for (const [p, l] of litersBy) {
        const price = priceOf(p);
        products[p] = { liters: r3(l.toNumber()), amount: price ? r2(l.times(price).toDecimalPlaces(2).toNumber()) : null };
      }
    }
    const liters = complete ? r3(Object.values(products).reduce((a, v) => a + (v?.liters ?? 0), 0)) : null;
    const amount = complete ? r2(Object.values(products).reduce((a, v) => a + (v?.amount ?? 0), 0)) : null;
    const collected = r2(network + fuelCard + cash + credit + expenses);
    const deviceDataComplete = sh.readingsSource === "controller" && sh.status !== "open"
      ? (await controllerDataStatus(tenantId, sh))?.complete ?? false
      : null;
    cells.push({
      day: sh.shiftDate.toISOString().slice(0, 10), costCenterId: sh.costCenterId,
      cell: {
        id: sh.id, shiftType: sh.shiftType as "morning" | "night", status: sh.status, worker: sh.stationUser?.name ?? null, openedAt: sh.openedAt, closedAt: sh.closedAt,
        readingsSource: sh.readingsSource, complete, deviceDataComplete, products, liters, amount, network: r2(network), fuelCard: r2(fuelCard), cash: r2(cash), credit: r2(credit), expenses: r2(expenses),
        collected, variance: amount == null || sh.status === "open" ? null : r2(collected - amount),
      },
    });
  }

  const rowsByKey = new Map<string, ShiftReportDayRow>();
  const totals = emptyTotals();
  const byType = { morning: emptyTotals(), night: emptyTotals() };
  for (const { day, costCenterId, cell } of cells) {
    const key = `${day}|${costCenterId}`;
    const row = rowsByKey.get(key) ?? { day, costCenterId, stationName: stationName.get(costCenterId) ?? "", morning: [], night: [], total: emptyTotals() };
    row[cell.shiftType].push(cell);
    addCell(row.total, cell);
    addCell(totals, cell);
    addCell(byType[cell.shiftType], cell);
    rowsByKey.set(key, row);
  }
  return { dateFrom: range.dateFrom, dateTo: range.dateTo, rows: [...rowsByKey.values()], totals, byType };
}
