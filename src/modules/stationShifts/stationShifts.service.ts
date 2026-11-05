import { companyVatRatePercent } from "../../lib/companyVat";
import { Prisma, StationFuelProduct, StationShiftType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound, forbidden, HttpError } from "../../lib/httpError";
import { createJournalEntryTx, recomputeEntryTotal, reserveEntryNumber, type PostingLine } from "../../lib/journalPosting";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { deleteObject } from "../../lib/storage";
import { controllerValuesForShift } from "../forecourt/forecourt.service";
import { computeShiftCogsTx, createShiftFuelIssuesTx, FUEL_PRODUCT_LABEL_AR } from "./stationShiftCogs";

export { FUEL_PRODUCT_LABEL_AR };

/** أي قيمة يقبلها مُنشئ Prisma.Decimal — نص أو رقم أو Decimal جاهز. */
type DecimalInput = Prisma.Decimal.Value;

// ضريبة القيمة المضافة 15% — السعر عند المضخة يشملها دائماً (priceInclVat)، وفق القسم 4 من هذه
// المواصفة صراحة؛ ليست إعداداً قابلاً للتخصيص هنا.
export const VAT_DIVISOR = new Prisma.Decimal("1.15");

/** حالات لا تحجز خانة (المحطة، التاريخ، النوع): خانتها تُستعاد لوردية جديدة أو مصحَّحة — نفس شرط الفهرس الجزئي في القاعدة. */
export const SLOT_FREEING_STATUSES = ["rejected", "reversed"] as const;

export interface NozzleReadingInput {
  nozzleId: string;
  /** "رقم المضخة-رقم الفوهة" لرسائل الخطأ (المحاسب لا يعرف المعرّف الداخلي للفوهة) */
  label?: string;
  product: StationFuelProduct;
  meterDigits: number;
  openingReading: DecimalInput;
  closingReading: DecimalInput;
  testLiters: DecimalInput;
}

export interface FuelPriceInput {
  product: StationFuelProduct;
  priceInclVat: DecimalInput;
  effectiveFrom: Date;
  /** مُعبَّأ فقط لسعر خاص بمحطة (مركز تكلفة) واحدة يتغلّب على السعر العام لنفس المنتج — راجع
   * تعليق FuelPrice.costCenterId في schema.prisma. على المستدعي أن يُمرِّر هنا فقط أسعار هذا
   * المنتج/هذه المحطة (عامة + خاصة بها تحديداً)، لا كل أسعار كل المحطات في النظام. */
  costCenterId?: string | null;
}

export interface CreditSaleInput {
  customerId: string;
  /** حساب الذمم الذي يُدان به هذا العميل — يُحلَّل من طرف المستدعي (عادةً Customer.accountId)،
   * فهذه الدالة خالصة ولا تصل لقاعدة البيانات لتحليله بنفسها. */
  accountId: string;
  amount: DecimalInput;
}

export interface ExpenseInput {
  /** حساب المصروف الذي يُقيَّد عليه هذا البند — يُحلَّل من طرف المستدعي حسب تصنيف كل مصروف. */
  accountId: string;
  amount: DecimalInput;
}

export interface ShiftClosingAccounts {
  /** الصندوق/البنك الذي استُلم فيه النقد المُسلَّم فعلياً (cashDelivered). */
  cashAccountId: string;
  /** إيراد بيع الوقود بالصافي (بدون ضريبة) — حساب مستقل لكل منتج (مطابقةً لقالب شجرة حسابات
   * "محطات وقود": إيراد بنزين 91/95/ديزل منفصلة، لا حساب إيراد وقود واحد مشترك). يجب أن يحمل
   * مفتاحاً لكل منتج ظهر فعلياً في مبيعات هذه الوردية بحجم أكبر من صفر، وإلا تُرمى نفس رسالة
   * "لا يوجد سعر بيع سارٍ" — غياب حساب الإيراد بيانات ناقصة بنفس خطورة غياب السعر. */
  revenueAccountByProduct: Partial<Record<StationFuelProduct, string>>;
  /** ضريبة القيمة المضافة المستحقة (مخرجات). */
  outputVatAccountId: string;
  /** ذمم مدينة — شبكة نقاط البيع (مدى/فيزا...). */
  networkReceivableAccountId: string;
  /** ذمم مدينة — بطاقات وقود (شركات تعبئة مسبقة). */
  fuelCardReceivableAccountId: string;
  /** عجز الصندوق (يُقيَّد مديناً عند نقص النقد المُسلَّم عن المستحق). */
  cashShortageAccountId: string;
  /** زيادة الصندوق (تُقيَّد دائناً عند زيادة النقد المُسلَّم عن المستحق). */
  cashSurplusAccountId: string;
}

export interface ShiftClosingInput {
  /** المحطة (مركز التكلفة) التي تخص هذه الوردية — تُنسَخ على كل سطر من سطور القيد الناتج. */
  costCenterId: string;
  shiftDate: Date;
  /** نسبة ضريبة الشركة بالمئة (vatRatePercentOf) — أسعار الوقود شاملة الضريبة؛ الافتراضي 15% */
  vatRatePercent?: number;
  readings: NozzleReadingInput[];
  /** أسعار الوقود المرشَّحة لهذه الوردية فقط (راجع تعليق FuelPriceInput.costCenterId أعلاه). */
  prices: FuelPriceInput[];
  networkAmount: DecimalInput;
  fuelCardAmount: DecimalInput;
  cashDelivered: DecimalInput;
  creditSales: CreditSaleInput[];
  expenses: ExpenseInput[];
  accounts: ShiftClosingAccounts;
}

export interface NozzleLitersResult {
  nozzleId: string;
  product: StationFuelProduct;
  liters: Prisma.Decimal;
}

export interface ProductSalesResult {
  product: StationFuelProduct;
  liters: Prisma.Decimal;
  /** null فقط عندما liters=0 لهذا المنتج — لا داعي للبحث عن سعر ساري لمنتج لم يُبَع منه شيء. */
  priceInclVat: Prisma.Decimal | null;
  /** شامل الضريبة. */
  amount: Prisma.Decimal;
  /** بالصافي (بدون ضريبة) — هذا ما يُقيَّد فعلياً على حساب إيراد هذا المنتج تحديداً. */
  netAmount: Prisma.Decimal;
}

export interface ShiftClosingResult {
  litersByNozzle: NozzleLitersResult[];
  salesByProduct: ProductSalesResult[];
  grossSales: Prisma.Decimal;
  revenueExclVat: Prisma.Decimal;
  outputVat: Prisma.Decimal;
  creditSalesTotal: Prisma.Decimal;
  expensesTotal: Prisma.Decimal;
  expectedCash: Prisma.Decimal;
  cashDue: Prisma.Decimal;
  variance: Prisma.Decimal;
  /** أسطر القيد المحاسبي الذي يُنشأ لاحقاً عبر createJournalEntryTx — مضمونة التوازن دائماً
   * (راجع تعليق computeShiftClosing أدناه). */
  lines: PostingLine[];
}

/**
 * كمية اللترات المباعة فعلياً من فوهة واحدة خلال الوردية = القراءة الختامية ناقص الافتتاحية،
 * ناقص لترات الاختبار (تُستهلك أثناء معايرة المضخة، لا في بيع حقيقي). لو ظهرت القراءة الختامية
 * أقل من الافتتاحية، يُفتَرض أن عداد الفوهة أكمل دورة كاملة وعاد للصفر: يُضاف 10^meterDigits
 * للقراءة الختامية *أولاً*، ثم تُطرح لترات الاختبار. الترتيب إلزامي؛ عكسه ينتج رقماً مختلفاً كلياً
 * عند حدوث لفّة فعلية. أي ناتج سالب (سواء لعدم كفاية افتراض اللفّة، أو لترات اختبار أكبر من
 * الكمية الفعلية) خطأ بيانات يُرفَض فوراً، لا يُصفَّر أو يُتجاهَل بصمت.
 */
/**
 * أقصى كمية معقولة لفوهة واحدة في وردية واحدة: فوهة تجارية تصرف نحو 40–50 لتراً في الدقيقة، أي أقل من
 * ذلك بكثير فعلياً طوال وردية كاملة حتى بتشغيل متواصل. أي ناتج أكبر ليس بيعاً بل خطأ: قراءة مكتوبة
 * أقل من الافتتاحية بالخطأ (فتُعامَل كلفّة وتضيف 10^meterDigits كاملة)، أو عدد خانات عداد خاطئ في
 * إعداد الفوهة — كلاهما كان سيُرحَّل للقيد كمبيعات خيالية.
 */
export const MAX_PLAUSIBLE_LITERS_PER_NOZZLE_SHIFT = 40_000;

export function computeNozzleLiters(reading: NozzleReadingInput): Prisma.Decimal {
  const opening = new Prisma.Decimal(reading.openingReading);
  let closing = new Prisma.Decimal(reading.closingReading);
  // سعة العداد = 10^meterDigits: لا يمكن لعداد بعدد خانات N أن يعرض قراءة ≥ هذه القيمة. قراءة تتجاوزها
  // تعني أن عدد الخانات المضبوط للفوهة أقل من الحقيقي — وهو نفس الخطأ الذي يُفسد حساب اللفّة، فيُرفَض
  // هنا صراحةً بدل أن يمرّ حساباً خاطئاً.
  const capacity = new Prisma.Decimal(10).pow(reading.meterDigits);
  for (const [label, value] of [["الافتتاحية", opening], ["الختامية", closing]] as const) {
    if (value.isNegative() || value.greaterThanOrEqualTo(capacity)) {
      throw badRequest(
        `القراءة ${label} (${value.toString()}) لا تتسع في عداد من ${reading.meterDigits} خانات للفوهة (${reading.label ?? reading.nozzleId}) — ` +
          "تحقّق من القراءة، أو من عدد خانات العداد في «إعداد المحطات»",
      );
    }
  }
  const rolledOver = closing.lessThan(opening);
  if (rolledOver) {
    closing = closing.plus(capacity);
  }
  const liters = closing.minus(opening).minus(new Prisma.Decimal(reading.testLiters));
  if (liters.isNegative()) {
    throw badRequest(`قراءة العداد غير صحيحة للفوهة (${reading.label ?? reading.nozzleId}): الكمية المحسوبة سالبة حتى بعد افتراض دورة كاملة للعداد`);
  }
  if (liters.greaterThan(MAX_PLAUSIBLE_LITERS_PER_NOZZLE_SHIFT)) {
    throw badRequest(
      `الكمية المحسوبة للفوهة (${reading.label ?? reading.nozzleId}) = ${liters.toDecimalPlaces(3).toString()} لتر، أكبر من المعقول لوردية واحدة ` +
        `(${MAX_PLAUSIBLE_LITERS_PER_NOZZLE_SHIFT} لتر)` +
        (rolledOver ? " — القراءة الختامية أقل من الافتتاحية فاعتُبرت لفّة عداد؛ " : " — ") +
        "تحقّق من القراءة ومن عدد خانات العداد في «إعداد المحطات»",
    );
  }
  return liters.toDecimalPlaces(3);
}

/**
 * السعر الساري لمنتج واحد بتاريخ الوردية. سعر خاص بهذه المحطة (costCenterId مُعبَّأ) يتغلّب
 * كلياً على السعر العام لنفس المنتج متى وُجد سعر خاص سارٍ بهذا التاريخ؛ وإلا يُستخدَم أحدث سعر
 * عام سارٍ. "الأحدث الساري" = أكبر effectiveFrom لا يتجاوز تاريخ الوردية؛ أي سعر بتاريخ سريان
 * مستقبلي بعد تاريخ الوردية يُتجاهَل.
 */
export function resolveEffectivePrice(product: StationFuelProduct, shiftDate: Date, prices: FuelPriceInput[]): Prisma.Decimal {
  const applicable = prices.filter((p) => p.product === product && p.effectiveFrom.getTime() <= shiftDate.getTime());
  const stationSpecific = applicable.filter((p) => p.costCenterId);
  const pool = stationSpecific.length > 0 ? stationSpecific : applicable.filter((p) => !p.costCenterId);
  if (pool.length === 0) {
    throw badRequest(`لا يوجد سعر بيع سارٍ لمنتج "${product}" بتاريخ الوردية`);
  }
  const latest = pool.reduce((a, b) => (a.effectiveFrom.getTime() >= b.effectiveFrom.getTime() ? a : b));
  return new Prisma.Decimal(latest.priceInclVat);
}

interface DecimalLine {
  accountId: string;
  costCenterId: string;
  customerId?: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

/**
 * المنطق الحسابي الخالص الكامل لإقفال وردية محطة واحدة — بلا أي قراءة/كتابة قاعدة بيانات وبلا
 * HTTP، بنفس نمط computeSettlementAdjustment في periodicSettlement.service.ts، ليُختبَر مباشرة
 * بمعزل تام عن أي بنية تحتية. Decimal (Prisma.Decimal، أي decimal.js) يُستخدَم في كل حساب وسيط —
 * بما فيها التحقق من توازن القيد — تجنباً لأي خطأ فاصلة عائمة عند قسمة الضريبة أو تجميع عشرات
 * أسطر المصروفات/المبيعات الآجلة؛ التحويل لأرقام JS عادية (number) يحدث فقط عند بناء
 * PostingLine[] في النهاية، لأن ذلك النوع (وcreateJournalEntryTx نفسها) يتعاملان مع number
 * مطابقةً لبقية النظام.
 *
 * تسليمات الخزان (TankDelivery) وقياساته (TankDip) لا تدخلان هذا الحساب إطلاقاً ولا يُشار
 * إليهما هنا بأي شكل: الوقود الوارد بالتسليم لا يمر عبر عداد الفوهة أبداً، فتضمينه في المعادلة
 * يُضخِّم رقم المبيعات بمقدار حجم كل تسليم بالخطأ.
 *
 * createJournalEntryTx لا تتحقق من توازن المدين/الدائن بنفسها (تثق أن كل موديول يبني أسطره
 * متوازنة بالتصميم) — هذه الدالة هي الحارس الوحيد لهذا القيد تحديداً: أي عدم توازن يُرمى كخطأ
 * فوراً، ولا تُعاد أي نتيجة غير متوازنة إطلاقاً مهما كان السبب.
 */
export function computeShiftClosing(input: ShiftClosingInput): ShiftClosingResult {
  const litersByNozzle: NozzleLitersResult[] = input.readings.map((r) => ({
    nozzleId: r.nozzleId,
    product: r.product,
    liters: computeNozzleLiters(r),
  }));

  const litersByProduct = new Map<StationFuelProduct, Prisma.Decimal>();
  for (const r of litersByNozzle) {
    litersByProduct.set(r.product, (litersByProduct.get(r.product) ?? new Prisma.Decimal(0)).plus(r.liters));
  }

  // مبلغ كل منتج (شامل الضريبة) ÷ 1.15 = صافي إيراد هذا المنتج تحديداً — يُحسَب لكل منتج على حدة
  // (لا كإجمالي واحد مقسوماً لاحقاً) لأن لكل منتج حساب إيراد مستقلاً يُقيَّد عليه بصافيه هو، لا
  // بحصة تناسبية من صافٍ إجمالي. مجموع هذه الأصناف الصافية = revenueExclVat الإجمالي أدناه بالضبط.
  const salesByProduct: ProductSalesResult[] = [];
  let grossSales = new Prisma.Decimal(0);
  let revenueExclVat = new Prisma.Decimal(0);
  for (const [product, liters] of litersByProduct) {
    if (liters.isZero()) {
      salesByProduct.push({ product, liters, priceInclVat: null, amount: new Prisma.Decimal(0), netAmount: new Prisma.Decimal(0) });
      continue;
    }
    const priceInclVat = resolveEffectivePrice(product, input.shiftDate, input.prices);
    const amount = liters.times(priceInclVat).toDecimalPlaces(2);
    const divisor = input.vatRatePercent === undefined ? VAT_DIVISOR : new Prisma.Decimal(1).plus(new Prisma.Decimal(input.vatRatePercent).dividedBy(100));
    const netAmount = amount.dividedBy(divisor).toDecimalPlaces(2);
    grossSales = grossSales.plus(amount);
    revenueExclVat = revenueExclVat.plus(netAmount);
    salesByProduct.push({ product, liters, priceInclVat, amount, netAmount });
  }
  grossSales = grossSales.toDecimalPlaces(2);
  revenueExclVat = revenueExclVat.toDecimalPlaces(2);
  // الضريبة = الفرق بين إجمالي المبيعات وإجمالي الصافي لكل الأصناف معاً — لا قسمة مستقلة، حتى
  // يبقى الصافي + الضريبة مساوياً لإجمالي المبيعات تماماً مهما كان أثر التقريب على كل منتج.
  const outputVat = grossSales.minus(revenueExclVat);

  const networkAmount = new Prisma.Decimal(input.networkAmount).toDecimalPlaces(2);
  const fuelCardAmount = new Prisma.Decimal(input.fuelCardAmount).toDecimalPlaces(2);
  const cashDelivered = new Prisma.Decimal(input.cashDelivered).toDecimalPlaces(2);
  const creditSalesTotal = input.creditSales
    .reduce((sum, c) => sum.plus(new Prisma.Decimal(c.amount)), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
  const expensesTotal = input.expenses
    .reduce((sum, e) => sum.plus(new Prisma.Decimal(e.amount)), new Prisma.Decimal(0))
    .toDecimalPlaces(2);

  const expectedCash = grossSales.minus(networkAmount).minus(creditSalesTotal).minus(fuelCardAmount).toDecimalPlaces(2);
  const cashDue = expectedCash.minus(expensesTotal).toDecimalPlaces(2);
  const variance = cashDelivered.minus(cashDue).toDecimalPlaces(2);

  const decimalLines: DecimalLine[] = [];
  const pushLine = (accountId: string, debit: Prisma.Decimal, credit: Prisma.Decimal, customerId?: string) => {
    if (debit.isZero() && credit.isZero()) return;
    decimalLines.push({ accountId, costCenterId: input.costCenterId, customerId, debit, credit });
  };

  for (const sale of salesByProduct) {
    if (sale.netAmount.isZero()) continue;
    const revenueAccountId = input.accounts.revenueAccountByProduct[sale.product];
    if (!revenueAccountId) {
      throw badRequest(`لا يوجد حساب إيراد مُحدَّد لمنتج "${sale.product}"`);
    }
    pushLine(revenueAccountId, new Prisma.Decimal(0), sale.netAmount);
  }
  pushLine(input.accounts.outputVatAccountId, new Prisma.Decimal(0), outputVat);
  pushLine(input.accounts.networkReceivableAccountId, networkAmount, new Prisma.Decimal(0));
  pushLine(input.accounts.fuelCardReceivableAccountId, fuelCardAmount, new Prisma.Decimal(0));
  for (const creditSale of input.creditSales) {
    pushLine(creditSale.accountId, new Prisma.Decimal(creditSale.amount).toDecimalPlaces(2), new Prisma.Decimal(0), creditSale.customerId);
  }
  for (const expense of input.expenses) {
    pushLine(expense.accountId, new Prisma.Decimal(expense.amount).toDecimalPlaces(2), new Prisma.Decimal(0));
  }
  pushLine(input.accounts.cashAccountId, cashDelivered, new Prisma.Decimal(0));
  if (variance.isNegative()) {
    pushLine(input.accounts.cashShortageAccountId, variance.abs(), new Prisma.Decimal(0));
  } else {
    pushLine(input.accounts.cashSurplusAccountId, new Prisma.Decimal(0), variance);
  }

  const totalDebit = decimalLines.reduce((sum, l) => sum.plus(l.debit), new Prisma.Decimal(0));
  const totalCredit = decimalLines.reduce((sum, l) => sum.plus(l.credit), new Prisma.Decimal(0));
  if (!totalDebit.equals(totalCredit)) {
    throw badRequest("القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن");
  }

  const lines: PostingLine[] = decimalLines.map((l) => ({
    accountId: l.accountId,
    costCenterId: l.costCenterId,
    customerId: l.customerId,
    debit: l.debit.toNumber(),
    credit: l.credit.toNumber(),
  }));

  return {
    litersByNozzle,
    salesByProduct,
    grossSales,
    revenueExclVat,
    outputVat,
    creditSalesTotal,
    expensesTotal,
    expectedCash,
    cashDue,
    variance,
    lines,
  };
}

// ---------------------------------------------------------------------------
// طبقة الخدمة (تصل لقاعدة البيانات) — تُنشئ مدخلات computeShiftClosing أعلاه من سجلات حقيقية،
// وتدير دورة حياة الوردية الكاملة (فتح → إدخال العامل → مراجعة/تصحيح المحاسب → اعتماد وترحيل، أو
// رفض). كل الدوال هنا غير خالصة عمداً (بخلاف القسم أعلاه) — هذا هو الحد الفاصل الوحيد المقصود.
// ---------------------------------------------------------------------------

/** لا يمكن للعامل تعديل وردية بعد إرسالها للمراجعة (submitted فما بعدها) تحت أي ظرف — حصراً وهي
 * لا تزال open. */
function assertShiftOpenForWorker(shift: { status: string }) {
  if (shift.status !== "open") {
    throw forbidden("لا يمكن للعامل تعديل وردية بعد إرسالها للمراجعة");
  }
}

/** يحمّل وردية العامل نفسه فقط (لا وردية عامل آخر حتى لو بنفس المحطة) وهي لا تزال open — نقطة
 * تحقق واحدة يعاد استخدامها في كل نقاط نهاية العامل الكاتبة. */
async function getOwnedOpenShift(tenantId: string, employeeId: string, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (shift.employeeId !== employeeId) throw forbidden("هذه الوردية ليست لك");
  assertShiftOpenForWorker(shift);
  return shift;
}

/** مثل getOwnedOpenShift، لكن بلا شرط "لا تزال open" — لمسارات قراءة فقط يحتاجها العامل حتى بعد
 * إرسال/اعتماد/ترحيل ورديته (مراجعة ما أدخله بنفسه)، مع نفس تحقق الملكية الصارم: لا وردية عامل
 * آخر إطلاقاً بصرف النظر عن حالتها. */
async function getOwnedShift(tenantId: string, employeeId: string, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (shift.employeeId !== employeeId) throw forbidden("هذه الوردية ليست لك");
  return shift;
}

/** يتحقق أن هذه القراءة تخص فعلاً الوردية shiftId المذكورة، وأن هذه الوردية مملوكة لهذا الموظف
 * بالذات — لرفع صورة عداد عبر بوابة الموظف (stationShifts.portal.routes.ts). لا شرط "لا تزال
 * open" هنا عمداً: صورة العداد قد تُرفَع بعد الإرسال أيضاً (تصحيح نسيان لاحق قبل الاعتماد). */
export async function assertOwnedReading(tenantId: string, employeeId: string, shiftId: string, readingId: string) {
  const reading = await prisma.stationShiftReading.findFirst({ where: { id: readingId, tenantId }, include: { shift: true } });
  if (!reading || reading.shiftId !== shiftId) throw notFound("القراءة غير موجودة");
  if (reading.shift.employeeId !== employeeId) throw forbidden("هذه القراءة ليست لك");
  return reading;
}

/** مثلها لمصروف وردية — راجع تعليق assertOwnedReading أعلاه. */
export async function assertOwnedExpense(tenantId: string, employeeId: string, shiftId: string, expenseId: string) {
  const expense = await prisma.stationShiftExpense.findFirst({ where: { id: expenseId, tenantId }, include: { shift: true } });
  if (!expense || expense.shiftId !== shiftId) throw notFound("المصروف غير موجود");
  if (expense.shift.employeeId !== employeeId) throw forbidden("هذا المصروف ليس لك");
  return expense;
}

/** آخر وردية سابقة لهذه المحطة (بصرف النظر عن حالتها — القراءة الفيزيائية للعداد حقيقة واقعة لا
 * تتعلق برفض/قبول المحاسب لحساباتها)، وقراءاتها الختامية لكل فوهة (تصحيح المحاسب إن وُجد يتغلّب
 * على قراءة العامل الأصلية، بنفس منطق loadShiftClosingInput أدناه) — أساس اشتقاق قراءات الافتتاح
 * التالية. excludeShiftId يستثني الوردية الحالية نفسها من البحث (مطلوب عند إضافة قراءة ثانية
 * لوردية مفتوحة بالفعل، حتى لا "تسبق نفسها" في الترتيب الزمني).
 */
async function getPreviousClosingReadings(tenantId: string, costCenterId: string, excludeShiftId?: string) {
  const previousShift = await prisma.stationShift.findFirst({
    where: { tenantId, costCenterId, id: excludeShiftId ? { not: excludeShiftId } : undefined },
    orderBy: [{ shiftDate: "desc" }, { createdAt: "desc" }],
    include: { readings: true },
  });
  const closingByNozzle = new Map<string, Prisma.Decimal>();
  for (const reading of previousShift?.readings ?? []) {
    // القيمة قد تكون فارغة حتى الآن (صُوِّر العداد لكن لم يراجعها المحاسب بعد) — تُستثنى هذه
    // الفوهة من الخريطة بدل رمي خطأ، فتؤول قراءة الافتتاح التالية للصفر بنفس منطق "أول وردية على
    // الإطلاق" أدناه؛ حالة نادرة (وردية جديدة تُفتَح قبل مراجعة السابقة) لا تستحق رفض الفتح كله.
    const value = reading.accountantConfirmedValue ?? reading.closingReading;
    if (value != null) closingByNozzle.set(reading.nozzleId, new Prisma.Decimal(value));
  }
  return { previousShift, closingByNozzle };
}

/** مثل getAccountIdByName، لكن تُرجع undefined بدل الرمي عند غياب الحساب — تُستخدَم حصراً لحسابات
 * إيراد المنتجات هنا: محطة قد لا تبيع فعلياً إلا نوعين من الثلاثة، فلا يصح رفض حل كل الحسابات
 * لمجرد غياب حساب منتج لم يُبَع أصلاً هذه الوردية (computeShiftClosing نفسها ترمي رسالة واضحة
 * لاحقاً لو غاب حساب منتج بيع فعلياً). أي خطأ آخر غير HttpError (فشل اتصال بقاعدة البيانات مثلاً)
 * يُعاد رميه كما هو، لا يُبتلَع بصمت. */
async function tryResolveAccountIdByName(tenantId: string, companyId: string, name: string): Promise<string | undefined> {
  try {
    return await getAccountIdByName(tenantId, companyId, name);
  } catch (error) {
    if (error instanceof HttpError) return undefined;
    throw error;
  }
}

/**
 * تحلّل كل الحسابات المحاسبية المطلوبة لترحيل قيد إقفال وردية محطة. أغلبها أسماء قياسية (عبر
 * getAccountIdByName — تتوافق مع أي قالب شجرة حسابات، طالما الأسماء البديلة مسجَّلة في
 * wellKnownAccounts.ts)، باستثناء عجز/زيادة الصندوق تحديداً: حقلان مضبوطان صراحةً على الشركة
 * نفسها (Company.stationCashShortageAccountId/stationCashSurplusAccountId)، لا اسم ثابت — إظهار
 * "عجز محطة كذا هذا الشهر" هو الغرض الأساسي من هذه الوحدة، فربطه باسم حساب عام قد لا يقصده كل
 * مستأجر بنفس المعنى يجعل هذا السؤال بلا إجابة موثوقة. الشركة الجديدة بنشاط "محطات وقود" تُزرَع
 * بحسابين مخصَّصين لهذا الغرض تلقائياً (createCompany في companies.controller.ts)، لكن الحقلين
 * يبقيان قابلين لإعادة التوجيه لأي حساب آخر من إعدادات الشركة متى احتاج المستأجر ذلك.
 *
 * شبكة نقاط البيع (مدى) وبطاقات الوقود/الأسطول حسابان منفصلان تماماً: تسويات الشبكة تدخل البنك
 * خلال أيام قليلة تلقائياً، بينما بطاقات الأسطول ذمم فعلية تحتاج فوترة وتحصيلاً يدوياً من شركة
 * التعبئة — دمجهما في حساب واحد يجعل مطابقة تسويات الشبكة بالبنك مستحيلة.
 *
 * كل بنود StationShiftExpense (بصرف النظر عن category الحر) لا تزال تُقيَّد على حساب عام واحد
 * ("مصروفات إدارية متنوعة أخرى") — category نص وصفي فقط حالياً، لا مُحدِّد حساب؛ قرار مقصود، ليس
 * سهواً (راجع الملخص المرافق).
 *
 * مُصدَّرة (لا خاصة بهذا الملف فقط) لأن stationShiftsReports.service.ts تعيد استخدامها حرفياً —
 * مرّة واحدة فقط لكل طلب تقرير (لا مرّة لكل وردية داخل حلقة)، تماماً كما هنا لكل استدعاء إقفال
 * وردية واحدة؛ لا مسار تسعير/حسابات ثانٍ مختلف يُبنى في وحدة التقارير إطلاقاً.
 */
/** حسابا ذمم قناتَي البطاقات اللذان يُقيَّد عليهما تحصيل الوردية — نفس الاسمين تُقفلهما تسويات البنك (cardSettlements). */
export const NETWORK_RECEIVABLE_ACCOUNT_NAME = "ذمم شبكة نقاط البيع (مدى)";
export const FUEL_CARD_RECEIVABLE_ACCOUNT_NAME = "ذمم شركات بطاقات الوقود/الأسطول";

export async function resolveShiftClosingAccounts(tenantId: string, companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { stationCashShortageAccountId: true, stationCashSurplusAccountId: true },
  });
  if (!company?.stationCashShortageAccountId || !company?.stationCashSurplusAccountId) {
    throw badRequest("لم يُحدَّد حسابا عجز/زيادة نقدية ورديات المحطات لهذه الشركة بعد — اضبطهما من إعدادات الشركة أولاً");
  }

  const [
    cashAccountId,
    dieselRevenueAccountId,
    gasoline91RevenueAccountId,
    gasoline95RevenueAccountId,
    outputVatAccountId,
    fuelCardReceivableAccountId,
    networkReceivableAccountId,
    otherExpenseAccountId,
  ] = await Promise.all([
    getAccountIdByName(tenantId, companyId, "صندوق نثرية الفروع/المواقع"),
    tryResolveAccountIdByName(tenantId, companyId, "إيراد مبيعات ديزل"),
    tryResolveAccountIdByName(tenantId, companyId, "إيراد مبيعات بنزين 91"),
    tryResolveAccountIdByName(tenantId, companyId, "إيراد مبيعات بنزين 95"),
    getAccountIdByName(tenantId, companyId, "ضريبة القيمة المضافة - مخرجات"),
    getAccountIdByName(tenantId, companyId, FUEL_CARD_RECEIVABLE_ACCOUNT_NAME),
    getAccountIdByName(tenantId, companyId, NETWORK_RECEIVABLE_ACCOUNT_NAME),
    getAccountIdByName(tenantId, companyId, "مصروفات إدارية متنوعة أخرى"),
  ]);

  const accounts: ShiftClosingAccounts = {
    cashAccountId,
    revenueAccountByProduct: {
      diesel: dieselRevenueAccountId,
      gasoline_91: gasoline91RevenueAccountId,
      gasoline_95: gasoline95RevenueAccountId,
    },
    outputVatAccountId,
    networkReceivableAccountId,
    fuelCardReceivableAccountId,
    cashShortageAccountId: company.stationCashShortageAccountId,
    cashSurplusAccountId: company.stationCashSurplusAccountId,
  };
  return { accounts, expenseAccountId: otherExpenseAccountId };
}

/** يبني مدخل computeShiftClosing الكامل من سجلات وردية حقيقية — نقطة التقاء واحدة يستخدمها كل من
 * ملخص العامل الحي (GET summary) وتفاصيل المحاسب (GET :id) وخطوة الاعتماد الفعلية، فلا يتكرر
 * منطق التحميل بثلاث نسخ قد تنحرف عن بعضها لاحقاً. */
async function loadShiftClosingInput(tenantId: string, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({
    where: { id: shiftId, tenantId },
    include: { readings: { include: { nozzle: true } }, creditSales: true, expenses: true, collection: true, employee: { select: { id: true, name: true } } },
  });
  if (!shift) throw notFound("الوردية غير موجودة");

  const [priceRows, { accounts, expenseAccountId }, vatRatePercent] = await Promise.all([
    // مقيَّد بالمستأجر والشركة صراحةً — السعر العام (costCenterId فارغ) لا يخص محطة بعينها، فبدون هذا
    // القيد كانت أسعار أي شركة أخرى تدخل الحساب (نفس نطاق stationShiftsReports.service.ts)
    prisma.fuelPrice.findMany({
      where: { tenantId: shift.tenantId, companyId: shift.companyId, OR: [{ costCenterId: shift.costCenterId }, { costCenterId: null }] },
    }),
    resolveShiftClosingAccounts(shift.tenantId, shift.companyId),
    companyVatRatePercent(shift.tenantId, shift.companyId),
  ]);

  const creditSales = await Promise.all(
    shift.creditSales.map(async (creditSale) => {
      const customer = await prisma.customer.findUnique({ where: { id: creditSale.customerId }, select: { accountId: true } });
      if (!customer?.accountId) {
        throw badRequest("العميل المرتبط ببيع آجل في هذه الوردية بلا حساب محاسبي — أكمل بياناته أولاً");
      }
      return { customerId: creditSale.customerId, accountId: customer.accountId, amount: creditSale.amount };
    }),
  );

  // لم يعد closingReading يُملأ من العامل إطلاقاً (تصوير فقط) — القيمة الوحيدة الممكنة قبل مراجعة
  // المحاسب هي accountantConfirmedValue؛ أي قراءة لم يراجعها المحاسب بعد (كلاهما فارغ) تُستثنى من
  // مدخل الحساب ويُرفَع hasUnconfirmedReading بدل تمرير قيمة فارغة لـ computeNozzleLiters (الذي
  // يفترض دائماً رقماً حقيقياً). المستدعي (getShiftById/approveShift) هو من يقرر ماذا يفعل بهذا
  // العلم — لا حساب مالي ولا اعتماد يجوز أن يمرّا وبعض القراءات لا تزال بلا قيمة.
  let hasUnconfirmedReading = false;
  const readings: NozzleReadingInput[] = [];
  for (const reading of shift.readings) {
    const closingReading = reading.accountantConfirmedValue ?? reading.closingReading;
    if (closingReading == null) {
      hasUnconfirmedReading = true;
      continue;
    }
    readings.push({
      nozzleId: reading.nozzleId,
      label: `${reading.nozzle.pumpNumber}-${reading.nozzle.nozzleNumber}`,
      product: reading.nozzle.product,
      meterDigits: reading.nozzle.meterDigits,
      openingReading: reading.openingReading,
      closingReading,
      testLiters: reading.testLiters,
    });
  }

  const input: ShiftClosingInput = {
    costCenterId: shift.costCenterId,
    shiftDate: shift.shiftDate,
    vatRatePercent,
    readings,
    prices: priceRows,
    networkAmount: shift.collection?.networkAmount ?? 0,
    fuelCardAmount: shift.collection?.fuelCardAmount ?? 0,
    cashDelivered: shift.collection?.cashDelivered ?? 0,
    creditSales,
    expenses: shift.expenses.map((expense) => ({ accountId: expenseAccountId, amount: expense.amount })),
    accounts,
  };
  return { shift, input, hasUnconfirmedReading };
}

/** المحطة (مركز التكلفة) المُسنَدة لموظف عامل عبر بوابة الموظف — تُشتَق من
 * Employee.assignedCostCenterId حصراً، لا من أي مدخل في الطلب، وفق القاعدة الصارمة: عامل لا
 * يصل إلا لمحطته المُسنَدة. لا فحص صلاحية منفصل هنا عمداً (بخلاف Position/PositionActionPermission
 * في الجانب الإداري) — بوابة الموظف لا تملك هذا المفهوم أصلاً، ووجود التخصيص نفسه هو "الصلاحية"
 * الوحيدة المطلوبة، تماماً كمبدأ managerId في وحدة الإجازات. */
async function getWorkerCostCenter(tenantId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId }, select: { assignedCostCenterId: true } });
  if (!employee?.assignedCostCenterId) throw badRequest("لا توجد محطة مُسنَدة لهذا الموظف");
  const costCenter = await prisma.costCenter.findUnique({ where: { id: employee.assignedCostCenterId }, select: { id: true, companyId: true } });
  if (!costCenter?.companyId) throw badRequest("محطة بلا شركة محددة، لا يمكن فتح وردية عليها");
  return { costCenterId: costCenter.id, companyId: costCenter.companyId };
}

/** بيانات نقطة "محطتي" — نوافذ العامل قبل فتح وردية جديدة: قائمة الفوهات، الأسعار السارية اليوم
 * (فارغة/null لمنتج بلا سعر مضبوط بعد بدل رفض الشاشة بالكامل — عرض فقط، لا التزام مالي)، وقراءات
 * إغلاق آخر وردية سابقة لكل فوهة (نفس ما سيُشتَق منه openingReading تلقائياً عند فتح وردية جديدة).
 */
export async function getMyStation(tenantId: string, employeeId: string) {
  const { costCenterId, companyId } = await getWorkerCostCenter(tenantId, employeeId);

  const [nozzles, priceRows] = await Promise.all([
    prisma.stationNozzle.findMany({ where: { costCenterId, isActive: true }, orderBy: [{ pumpNumber: "asc" }, { nozzleNumber: "asc" }] }),
    prisma.fuelPrice.findMany({ where: { tenantId, companyId, OR: [{ costCenterId }, { costCenterId: null }] } }),
  ]);

  const today = new Date();
  const effectivePrices: Partial<Record<StationFuelProduct, number>> = {};
  for (const product of new Set(nozzles.map((n) => n.product))) {
    try {
      effectivePrices[product] = resolveEffectivePrice(product, today, priceRows).toNumber();
    } catch {
      // لا سعر ساري بعد لهذا المنتج — يبقى غائباً من الرد، الشاشة تعرضه "غير مضبوط" بدل رفض الطلب كله
    }
  }

  const { previousShift, closingByNozzle } = await getPreviousClosingReadings(tenantId, costCenterId);
  // نفس قاعدة submitReading: فوهة بلا وردية سابقة تبدأ من قراءتها المُسجَّلة عند التعريف
  const previousClosingReadings = Object.fromEntries(
    nozzles.map((n) => [n.id, (closingByNozzle.get(n.id) ?? new Prisma.Decimal(n.initialReading)).toNumber()]),
  );

  return { costCenterId, nozzles, effectivePrices, previousShiftId: previousShift?.id ?? null, previousClosingReadings };
}

/**
 * لا تُفتَح وردية على محطة غير مُعدَّة: بلا مضخات لا شيء يُقرأ (كانت الشاشة تظهر فارغة بلا تفسير)، وبلا
 * سعر ساري لمنتج تبيعه المحطة لا يمكن تسعير الوردية ولا ترحيلها لاحقاً. الرسالة موجّهة لما ينقص تحديداً،
 * ليُبلِغ العامل المسؤول بدل أن يعلق في وردية لا تكتمل.
 */
export async function assertStationReadyForShift(tenantId: string, companyId: string, costCenterId: string, shiftDate: Date) {
  const nozzles = await prisma.stationNozzle.findMany({ where: { tenantId, costCenterId, isActive: true }, select: { product: true } });
  if (nozzles.length === 0) {
    throw badRequest("لا يمكن فتح وردية: لا توجد مضخات مُعرَّفة لهذه المحطة بعد — على المسؤول إضافتها من «ورديات المحطات ← إعداد المحطات»");
  }
  const prices = await prisma.fuelPrice.findMany({
    where: { tenantId, companyId, OR: [{ costCenterId }, { costCenterId: null }], effectiveFrom: { lte: shiftDate } },
    select: { product: true, priceInclVat: true, effectiveFrom: true, costCenterId: true },
  });
  const missing = [...new Set(nozzles.map((n) => n.product))].filter((product) => !prices.some((p) => p.product === product));
  if (missing.length > 0) {
    throw badRequest(
      `لا يمكن فتح وردية: لا يوجد سعر بيع ساري اليوم لـ ${missing.map((p) => FUEL_PRODUCT_LABEL_AR[p]).join("، ")} — ` +
        "على المسؤول إضافته من «ورديات المحطات ← أسعار الوقود»",
    );
  }
}

export interface OpenShiftInput {
  shiftType: StationShiftType;
}

// select صريح لأي StationShift يُعاد للعامل مباشرة (فتح/إرسال) — يستثني عمداً كل حقول ما بعد
// المراجعة (journalEntryId، reviewedByUserId، rejectionReasonCode/Note) رغم كونها فارغة دائماً
// في هاتين النقطتين تحديداً (الفتح والإرسال كلاهما ضمن status="open" فقط)؛ دفاع استباقي بحت حتى
// لا يُسرَّب أي حقل يُضاف مستقبلاً لهذا الجدول بصمت لمجرد إضافته للمخطط.
const WORKER_SHIFT_SELECT = {
  id: true,
  costCenterId: true,
  shiftDate: true,
  shiftType: true,
  openedAt: true,
  closedAt: true,
  status: true,
} as const;

/** فتح وردية جديدة — costCenterId يُشتَق دائماً من تعيين المستخدم نفسه (لا من الطلب إطلاقاً)،
 * وshiftDate هو تاريخ اليوم الحالي (منتصف الليل UTC) لحظة الفتح، لا قيمة يختارها العامل. القيد
 * الفريد (costCenterId, shiftDate, shiftType) يمنع فتح وردية مكررة لنفس المحطة/اليوم/النوع —
 * يُتحقَّق منه هنا صراحة برسالة واضحة بدل الاعتماد على رسالة قيد قاعدة البيانات العامة فقط.
 */
export async function openShift(tenantId: string, employeeId: string, input: OpenShiftInput) {
  const { costCenterId, companyId } = await getWorkerCostCenter(tenantId, employeeId);
  const shiftDate = new Date();
  shiftDate.setUTCHours(0, 0, 0, 0);
  await assertStationReadyForShift(tenantId, companyId, costCenterId, shiftDate);

  // الخانة فريدة للورديات القائمة فقط (فهرس جزئي station_shifts_active_slot_key): المرفوضة والمعكوسة لا تحجزها
  const existing = await prisma.stationShift.findFirst({
    where: { tenantId, costCenterId, shiftDate, shiftType: input.shiftType, status: { notIn: [...SLOT_FREEING_STATUSES] } },
  });
  if (existing) throw badRequest("توجد وردية بالفعل لهذه المحطة بنفس التاريخ ونوع الوردية");

  return prisma.stationShift.create({
    // isSeedData: false صريحاً هنا (لا اعتماداً على @default(false) في المخطط فقط) — أي وردية
    // حقيقية يفتحها عامل عبر بوابة الموظف يجب أن تكون false بنيوياً بصرف النظر عن أي تغيير مستقبلي
    // للقيمة الافتراضية في المخطط؛ العلامة الوحيدة المسموح لها ضبطها true هي
    // scripts/seed-station-pumps-demo.ts، لا أي مسار آخر في كل النظام.
    data: { tenantId, companyId, costCenterId, employeeId, shiftDate, shiftType: input.shiftType, openedAt: new Date(), status: "open", isSeedData: false },
    select: WORKER_SHIFT_SELECT,
  });
}

export interface SubmitReadingInput {
  nozzleId: string;
  capturedAt: Date;
  latitude?: number;
  longitude?: number;
}

/** تسجيل تصوير عداد فوهة واحدة ضمن وردية العامل المفتوحة — العامل لا يكتب أي رقم هنا إطلاقاً
 * (بلا closingReading ولا testLiters ولا workerConfirmedValue)، فقط يوثِّق أنه صوَّر هذا العداد
 * الآن (capturedAt/الموقع)؛ صورة العداد الفعلية تُرفَع بعدها عبر نقطة نهاية منفصلة
 * (POST .../readings/:readingId/photo) تحتاج معرّف هذه القراءة. openingReading يُشتَق دائماً من
 * قراءة الإغلاق المعتمَدة في آخر وردية سابقة لنفس الفوهة (صفر لو أول وردية، أو لو لم تُراجَع
 * القراءة السابقة بعد — راجع تعليق getPreviousClosingReadings)، ولا يُقبَل إطلاقاً من الطلب.
 * القيمة الفعلية (closingReading/accountantConfirmedValue) تبقى فارغة حتى يكتبها المحاسب أثناء
 * المراجعة (correctReading) — لا تحقق من صحة الكمية هنا، إذ لا رقم بعد للتحقق منه؛ هذا التحقق
 * (computeNozzleLiters) انتقل بالكامل لمرحلة إدخال المحاسب. upsert بدل create: العامل قد يعيد
 * تصوير نفس الفوهة أكثر من مرة (إعادة تصوير) قبل الإرسال النهائي (submit).
 */
export async function submitReading(tenantId: string, employeeId: string, shiftId: string, input: SubmitReadingInput) {
  const shift = await getOwnedOpenShift(tenantId, employeeId, shiftId);

  const nozzle = await prisma.stationNozzle.findFirst({
    where: { id: input.nozzleId, costCenterId: shift.costCenterId, tenantId, isActive: true },
  });
  if (!nozzle) throw badRequest("الفوهة غير موجودة أو لا تتبع محطة هذه الوردية");

  const { closingByNozzle } = await getPreviousClosingReadings(tenantId, shift.costCenterId, shift.id);
  // أول وردية على هذه الفوهة: قراءة العداد المُسجَّلة عند تعريفها في «إعداد المحطات» (initialReading)،
  // لا صفر — الصفر كان يحتسب كامل القراءة التراكمية للعداد مبيعاتٍ في أول وردية.
  const openingReading = closingByNozzle.get(nozzle.id) ?? new Prisma.Decimal(nozzle.initialReading);

  // select صريح (لا يعيد الصف الخام كاملاً): يستثني تحديداً accountantConfirmedValue — غير
  // قابل للتسريب فعلياً هنا (getOwnedOpenShift أعلاه يرفض أصلاً لو غادرت الوردية "open"، وتصحيح
  // المحاسب لا يحدث إلا بعدها)، لكن دفاع استباقي: أي حقل مالي/تدقيقي يُضاف مستقبلاً لهذا الجدول
  // لن يظهر في رد هذا المسار الخاص بالعامل بصمت لمجرد إضافته للمخطط.
  const readingSelect = {
    id: true,
    nozzleId: true,
    openingReading: true,
    closingReading: true,
    testLiters: true,
    workerConfirmedValue: true,
    capturedAt: true,
    latitude: true,
    longitude: true,
  } as const;

  return prisma.stationShiftReading.upsert({
    where: { shiftId_nozzleId: { shiftId: shift.id, nozzleId: nozzle.id } },
    create: {
      tenantId,
      companyId: shift.companyId,
      shiftId: shift.id,
      nozzleId: nozzle.id,
      openingReading,
      capturedAt: input.capturedAt,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    update: {
      capturedAt: input.capturedAt,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    select: readingSelect,
  });
}

export interface UpdateCollectionsInput {
  networkAmount: number;
  fuelCardAmount: number;
  cashDelivered: number;
}

export async function updateCollections(tenantId: string, employeeId: string, shiftId: string, input: UpdateCollectionsInput) {
  const shift = await getOwnedOpenShift(tenantId, employeeId, shiftId);
  return prisma.stationShiftCollection.upsert({
    where: { shiftId: shift.id },
    create: { tenantId, companyId: shift.companyId, shiftId: shift.id, ...input },
    update: { ...input },
  });
}

export interface AddCreditSaleInput {
  customerId: string;
  amount: number;
  voucherNumber: string;
}

export async function addCreditSale(tenantId: string, employeeId: string, shiftId: string, input: AddCreditSaleInput) {
  const shift = await getOwnedOpenShift(tenantId, employeeId, shiftId);
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: shift.companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");
  return prisma.stationShiftCreditSale.create({ data: { tenantId, companyId: shift.companyId, shiftId: shift.id, ...input } });
}

export interface AddExpenseInput {
  amount: number;
  category: string;
  description?: string;
}

export async function addExpense(tenantId: string, employeeId: string, shiftId: string, input: AddExpenseInput) {
  const shift = await getOwnedOpenShift(tenantId, employeeId, shiftId);
  return prisma.stationShiftExpense.create({ data: { tenantId, companyId: shift.companyId, shiftId: shift.id, ...input } });
}

/**
 * ملخص العامل الخاص بورديته — أمنياً مقصود أن يبقى مختلفاً تماماً عن getShiftById (المحاسب):
 * لا يستدعي computeShiftClosing إطلاقاً، فلا cashDue/variance/expectedCash/lines أو حتى
 * مبيعات/إيرادات محسوبة تصل لهذا المسار أبداً بأي شكل — فقط إعادة عرض بسيطة لما أدخله العامل
 * نفسه فعلاً (قراءاته/تحصيله/مبيعاته الآجلة/مصروفاته)، بلا أي حساب مشتق. الفرق المالي (عجز/زيادة
 * الصندوق) حصري تماماً لشاشة المحاسب (getShiftById، reviewAccess فقط).
 *
 * ملكية صارمة (لا company-scope عام فقط كما كان سابقاً): getOwnedShift يتحقق أن هذه الوردية
 * تخص هذا العامل بالذات، وإلا يرفض — دون هذا التحقق كان أي عامل داخل نفس الشركة يقدر يمرّر معرّف
 * وردية عامل آخر (حتى بمحطة مختلفة تماماً) ويرى تفاصيلها. يعمل بصرف النظر عن حالة الوردية (حتى
 * بعد الإرسال/الاعتماد/الترحيل) لأنه يبقى "ملخص وردية العامل نفسه"، لا مقصوراً على وهي مفتوحة.
 */
export async function getShiftSummary(tenantId: string, employeeId: string, shiftId: string) {
  const shift = await getOwnedShift(tenantId, employeeId, shiftId);
  const [readings, expenses, creditSales] = await Promise.all([
    prisma.stationShiftReading.findMany({ where: { shiftId: shift.id }, include: { nozzle: true }, orderBy: { capturedAt: "asc" } }),
    prisma.stationShiftExpense.findMany({ where: { shiftId: shift.id } }),
    prisma.stationShiftCreditSale.findMany({ where: { shiftId: shift.id } }),
  ]);
  const collection = await prisma.stationShiftCollection.findUnique({ where: { shiftId: shift.id } });

  return {
    id: shift.id,
    status: shift.status,
    shiftType: shift.shiftType,
    shiftDate: shift.shiftDate,
    readings: readings.map((r) => ({
      id: r.id,
      nozzleId: r.nozzleId,
      pumpNumber: r.nozzle.pumpNumber,
      nozzleNumber: r.nozzle.nozzleNumber,
      product: r.nozzle.product,
      openingReading: r.openingReading,
      closingReading: r.closingReading,
      testLiters: r.testLiters,
      workerConfirmedValue: r.workerConfirmedValue,
      capturedAt: r.capturedAt,
    })),
    collection: collection ? { networkAmount: collection.networkAmount, fuelCardAmount: collection.fuelCardAmount, cashDelivered: collection.cashDelivered } : null,
    creditSales: creditSales.map((c) => ({ id: c.id, customerId: c.customerId, amount: c.amount, voucherNumber: c.voucherNumber })),
    expenses: expenses.map((e) => ({ id: e.id, amount: e.amount, category: e.category, description: e.description })),
  };
}

export async function submitShift(tenantId: string, employeeId: string, shiftId: string) {
  const shift = await getOwnedOpenShift(tenantId, employeeId, shiftId);
  return prisma.stationShift.update({
    where: { id: shift.id },
    data: { status: "submitted", closedAt: new Date() },
    select: WORKER_SHIFT_SELECT,
  });
}

const PENDING_STATUSES = ["submitted", "under_review"] as const;
// approved فما دونها (بلا posted/rejected) — الرفض يبقى ممكناً حتى بعد الاعتماد طالما لم يُرحَّل
// قيد بعد (لا شيء كُتب في الدفاتر)؛ التصحيح والاعتماد أنفسهما يبقيان مقصورين على PENDING_STATUSES
// فقط (المراجعة تحديداً، لا "جاهزة للترحيل").
const REJECTABLE_STATUSES = [...PENDING_STATUSES, "approved"] as const;

export async function listPendingShifts(tenantId: string, companyId?: string) {
  return prisma.stationShift.findMany({
    where: { tenantId, companyId, status: { in: [...PENDING_STATUSES] } },
    include: { costCenter: true, employee: { select: { id: true, name: true } } },
    // آخر ما أُدخل أولاً (قرار المالك) — كانت الأقدم تاريخاً أولاً
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/** تفاصيل وردية كاملة لشاشة المحاسب: السجل الخام (قراءات/تحصيل/مبيعات آجلة/مصروفات/سجل تدقيق)
 * بالإضافة إلى الملخص الحسابي الكامل عبر computeShiftClosing (عجز/زيادة الصندوق، سطور القيد
 * المرتقب...). هذه هي النقطة الوحيدة في كل الوحدة التي تكشف هذا الحساب — reviewAccess فقط
 * (راجع stationShifts.routes.ts)، ولا صلة لها إطلاقاً بـ getShiftSummary الخاصة بالعامل أدناه،
 * والتي لا تحسب أي شيء مالي مشتق عمداً منذ إصلاح تسريب عجز/زيادة الصندوق لصلاحية العامل. */
export async function getShiftById(tenantId: string, shiftId: string) {
  const { shift, input, hasUnconfirmedReading } = await loadShiftClosingInput(tenantId, shiftId);
  const auditLogs = await prisma.stationShiftAuditLog.findMany({ where: { shiftId }, orderBy: { createdAt: "desc" } });
  // لا يُحسَب أي شيء مالي (مبيعات/صافي نقدية/سطور قيد) طالما بقيت قراءة واحدة بلا قيمة مؤكَّدة من
  // المحاسب — عرض رقم جزئي هنا (متجاهلاً فوهة لم تُراجَع بعد) أخطر من عدم عرض شيء إطلاقاً، فقد
  // يُقرأ خطأً كرقم نهائي صحيح. الشاشة تعرض null هنا كـ"لم تكتمل المراجعة بعد" وتترك تفاصيل كل
  // قراءة (readings أدناه) لتوضيح أيها لا يزال ناقصاً.
  const closing = hasUnconfirmedReading ? null : computeShiftClosing(input);
  const summary = closing ? { ...closing, ...(await shiftJournalPreview(tenantId, shift, closing)) } : null;
  // قراءة المتحكم (PTS-2) لكل فوهة مربوطة — للمقارنة بقراءة الصورة فقط؛ لا تُعتمَد إلا إن قبلها المحاسب
  const controllerValues = await controllerValuesForShift(tenantId, shift);
  return { ...shift, summary, auditLogs, controllerValues };
}

/**
 * القيد كما يظهر للمحاسب: لوردية لها قيد (مرحَّلة/معكوسة) أسطر قيدها الفعلي كما رُحِّل؛ وإلا القيد المرتقب = أسطر الإقفال
 * (computeShiftClosing) + أسطر تكلفة البضاعة المباعة بنفس حساب الترحيل (computeShiftCogsTx بلا قفل). نقص إعداد التكلفة لا
 * يُسقط الشاشة: يظهر سببه في cogsError (وهو نفسه ما سيرفض به الاعتماد والترحيل). أسماء الحسابات ورموزها للعرض فقط.
 */
async function shiftJournalPreview(tenantId: string, shift: { companyId: string; costCenterId: string; journalEntryId: string | null }, closing: ShiftClosingResult) {
  let lines: PostingLine[];
  let cogsLines: PostingLine[] = [];
  let cogsError: string | null = null;
  let linesSource: "posted" | "preview" = "preview";
  if (shift.journalEntryId) {
    linesSource = "posted";
    const posted = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: shift.journalEntryId, journalEntry: { tenantId, companyId: shift.companyId } },
      orderBy: { id: "asc" },
    });
    lines = posted.map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId, customerId: l.customerId, lineDescription: l.description, debit: Number(l.debit), credit: Number(l.credit) }));
  } else {
    try {
      cogsLines = (await computeShiftCogsTx(prisma, {
        tenantId, companyId: shift.companyId, costCenterId: shift.costCenterId,
        sales: closing.salesByProduct.map((p) => ({ product: p.product, liters: p.liters })),
      }, { lock: false })).lines;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      cogsError = err.message;
    }
    lines = [...closing.lines, ...cogsLines];
  }
  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId: shift.companyId, id: { in: [...new Set(lines.map((l) => l.accountId))] } },
    select: { id: true, code: true, name: true, nameEn: true },
  });
  return { lines, cogsLines, cogsError, linesSource, accounts };
}

/** إدخال/تصحيح المحاسب لقيمة قراءة عداد واحدة أثناء المراجعة — منذ إزالة الإدخال اليدوي من شاشة
 * العامل (تصوير فقط، بلا OCR بعد)، هذه هي المرة الأولى فعلياً التي يظهر فيها أي رقم لهذه القراءة
 * في أغلب الأحيان، لا مجرد "تصحيح" قيمة عامل موجودة أصلاً — لكن نفس الآلية تبقى صالحة لتصحيح قيمة
 * سبق إدخالها أيضاً. يكتب دائماً صفاً في StationShiftAuditLog (لا استثناء)، ويحوّل حالة الوردية
 * إلى under_review تلقائياً لو كانت لا تزال submitted فقط (أول إدخال/تصحيح يبدأ "قيد المراجعة"
 * فعلياً؛ ما يليه لا يُعيد هذا التحويل). القيمة المُدخَلة (accountantConfirmedValue) هي ما يدخل
 * الحساب المالي فعلياً — راجع تعليق loadShiftClosingInput أعلاه. تُرفَض القيمة فوراً بنفس منطق
 * computeNozzleLiters الخالص (لا عند الاعتماد لاحقاً فقط) لو نتجت عنها كمية سالبة حتى بعد افتراض
 * لفّة كاملة للعداد — نفس فحص "فشل فوري" الذي كان يجري على إدخال العامل قبل هذه المرحلة.
 */
export async function correctReading(tenantId: string, userId: string, shiftId: string, readingId: string, accountantConfirmedValue: number) {
  const reading = await prisma.stationShiftReading.findFirst({
    where: { id: readingId, shiftId, tenantId },
    include: { shift: true, nozzle: true },
  });
  if (!reading) throw notFound("القراءة غير موجودة");
  if (!(PENDING_STATUSES as readonly string[]).includes(reading.shift.status)) {
    throw badRequest("لا يمكن تصحيح قراءة لوردية ليست قيد المراجعة");
  }

  computeNozzleLiters({
    nozzleId: reading.nozzleId,
    label: `${reading.nozzle.pumpNumber}-${reading.nozzle.nozzleNumber}`,
    product: reading.nozzle.product,
    meterDigits: reading.nozzle.meterDigits,
    openingReading: reading.openingReading,
    closingReading: accountantConfirmedValue,
    testLiters: reading.testLiters,
  });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.stationShiftReading.update({ where: { id: readingId }, data: { accountantConfirmedValue } });
    await tx.stationShiftAuditLog.create({
      data: {
        tenantId,
        companyId: reading.companyId,
        shiftId,
        userId,
        action: "correct_reading",
        fieldName: "accountantConfirmedValue",
        oldValue: reading.accountantConfirmedValue?.toString() ?? null,
        newValue: String(accountantConfirmedValue),
      },
    });
    if (reading.shift.status === "submitted") {
      await tx.stationShift.update({ where: { id: shiftId }, data: { status: "under_review" } });
    }
    return updated;
  });
}

/**
 * اعتماد وردية — يُثبِّت أن أرقامها مكتملة وصحيحة (كل فوهة نشطة لها قراءة ومعها صورة عداد)
 * وينقلها إلى الحالة "approved"، لكنه لا يكتب أي قيد محاسبي إطلاقاً ولا يمسّ journalEntryId؛
 * الترحيل الفعلي خطوة ثانية منفصلة تماماً (postShift أدناه) — "الأرقام مؤكَّدة لكن الدفاتر لم
 * تُمسّ بعد". يُرفَض الاعتماد كاملاً (قبل أي كتابة) لو نقصت قراءة فوهة نشطة واحدة، أو نقصت صورة
 * عداد (Attachment) لقراءة موجودة فعلاً. لا يجوز تصحيح أي قراءة بعد هذه النقطة (correctReading
 * مقصورة على PENDING_STATUSES) — اكتشاف خطأ بعد الاعتماد يتطلب رفض الوردية (rejectShift، لا يزال
 * ممكناً من approved) بدل تصحيحها في مكانها.
 */
export async function approveShift(tenantId: string, userId: string, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (!(PENDING_STATUSES as readonly string[]).includes(shift.status)) {
    throw badRequest("لا يمكن اعتماد وردية ليست قيد المراجعة");
  }

  const [activeNozzles, readings] = await Promise.all([
    prisma.stationNozzle.findMany({ where: { costCenterId: shift.costCenterId, isActive: true }, select: { id: true } }),
    prisma.stationShiftReading.findMany({ where: { shiftId }, select: { id: true, nozzleId: true } }),
  ]);
  const readingByNozzle = new Map(readings.map((r) => [r.nozzleId, r]));
  for (const nozzle of activeNozzles) {
    if (!readingByNozzle.has(nozzle.id)) throw badRequest("لا يمكن اعتماد الوردية: إحدى الفوهات بلا قراءة مسجَّلة بعد");
  }

  // صورة العداد إثبات القراءة: على القراءة نفسها، أو — لوردية مصحَّحة — على قراءة نفس الفوهة في الوردية التي استبدلتها
  // (وما قبلها إن كانت هي نفسها مصحَّحة): القراءة المصحَّحة تخصّ نفس العداد في نفس اللحظة.
  const evidenceIdsByNozzle = new Map(readings.map((r) => [r.nozzleId, [r.id]]));
  let replacedId = shift.correctsShiftId;
  for (let depth = 0; replacedId && depth < 20; depth++) {
    const replaced = await prisma.stationShift.findFirst({
      where: { id: replacedId, tenantId, companyId: shift.companyId, costCenterId: shift.costCenterId },
      select: { correctsShiftId: true, readings: { select: { id: true, nozzleId: true } } },
    });
    if (!replaced) break;
    for (const r of replaced.readings) evidenceIdsByNozzle.get(r.nozzleId)?.push(r.id);
    replacedId = replaced.correctsShiftId;
  }
  const evidenceIds = [...evidenceIdsByNozzle.values()].flat();
  const attachedReadingIds = evidenceIds.length
    ? await prisma.attachment.findMany({
        where: { tenantId, entityType: "station_shift_reading", entityId: { in: evidenceIds } },
        select: { entityId: true },
      })
    : [];
  const withPhoto = new Set(attachedReadingIds.map((a) => a.entityId));
  for (const reading of readings) {
    if (!evidenceIdsByNozzle.get(reading.nozzleId)!.some((id) => withPhoto.has(id))) {
      throw badRequest("لا يمكن اعتماد الوردية: إحدى القراءات بلا صورة عداد مرفقة بعد");
    }
  }

  // يحسب الإقفال الآن أيضاً (لا فقط لاحقاً عند الترحيل) عمداً: لو حساب مفقود من إعدادات الشركة
  // (مثال: عجز/زيادة الصندوق) سيظهر الخطأ هنا، لحظة "التأكيد"، لا مفاجأةً لاحقاً عند الترحيل.
  const { input, hasUnconfirmedReading } = await loadShiftClosingInput(tenantId, shiftId);
  // العامل لا يكتب أي رقم إطلاقاً (تصوير فقط) — فمراجعة المحاسب (correctReading) لكل قراءة إلزامية
  // قبل الاعتماد، لا اختيارية كما كانت أيام الإدخال اليدوي للعامل؛ بلا هذا الفحص كان
  // computeShiftClosing سيتجاهل بصمت أي فوهة لم تُراجَع بعد (راجع تعليق loadShiftClosingInput).
  if (hasUnconfirmedReading) {
    throw badRequest("لا يمكن اعتماد الوردية: إحدى القراءات لم يراجعها المحاسب بعد");
  }
  const closing = computeShiftClosing(input);
  // فحص مسبق لشروط تكلفة البضاعة المباعة (ربط الصنف، مستودع المحطة، متوسط غير صفري، كفاية الرصيد إن مُنع السالب) بنفس
  // رسائل الترحيل — حتى لا تُعتمَد وردية ثم يفشل ترحيلها لسبب إعداد. الترحيل يعيد الفحص تحت القفل.
  await computeShiftCogsTx(prisma, {
    tenantId, companyId: shift.companyId, costCenterId: shift.costCenterId,
    sales: closing.salesByProduct.map((p) => ({ product: p.product, liters: p.liters })),
  }, { lock: false });

  return prisma.$transaction(async (tx) => {
    await tx.stationShiftAuditLog.create({
      data: { tenantId, companyId: shift.companyId, shiftId, userId, action: "approve", fieldName: "status", oldValue: shift.status, newValue: "approved" },
    });
    return tx.stationShift.update({ where: { id: shift.id }, data: { status: "approved" } });
  });
}

/**
 * ترحيل وردية مُعتمَدة بالفعل — الخطوة الثانية والأخيرة، منفصلة تماماً عن approveShift أعلاه:
 * تحسب الإقفال من جديد (نفس المدخلات لم تتغيّر — لا تصحيح ولا كتابة عامل ممكنان بعد الاعتماد)
 * وتُنشئ القيد المحاسبي فعلياً عبر createJournalEntryTx، ثم تنقل الحالة إلى "posted" وتضبط
 * journalEntryId في نفس المعاملة الذرّية. مضمونة عدم التكرار (idempotent): مقصورة على شرط
 * الحالة = approved تحديداً، فترحيل وردية "posted" بالفعل (أو أي حالة أخرى) يُرفَض فوراً قبل أي
 * كتابة، ولا يُنشئ أبداً قيداً ثانياً لنفس الوردية.
 */
export async function postShift(tenantId: string, userId: string, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (shift.status !== "approved") {
    throw badRequest("لا يمكن ترحيل وردية لم تُعتمَد بعد، أو رُحِّلت بالفعل");
  }

  const { input } = await loadShiftClosingInput(tenantId, shiftId);
  const summary = computeShiftClosing(input);

  return prisma.$transaction(async (tx) => {
    // حجز الوردية ذرّياً قبل إنشاء القيد: فحص الحالة أعلاه وحده لا يمنع طلبَي ترحيل متزامنين من
    // قراءة "approved" معاً وإنشاء قيدين. التحديث المشروط يمرّ لطلب واحد فقط، والآخر يُرفَض وتُلغى
    // معاملته قبل أي قيد.
    const claimed = await tx.stationShift.updateMany({
      where: { id: shift.id, tenantId, status: "approved" },
      data: { status: "posted" },
    });
    if (claimed.count !== 1) {
      throw badRequest("لا يمكن ترحيل وردية لم تُعتمَد بعد، أو رُحِّلت بالفعل");
    }

    // تكلفة البضاعة المباعة بالمتوسط المرجّح من مستودع المحطة — في نفس القيد ونفس المعاملة: أي رفض هنا (ربط ناقص،
    // متوسط صفر، رصيد غير كافٍ) يُلغي حجز الوردية أعلاه أيضاً، فتبقى "approved" بلا قيد.
    const cogs = await computeShiftCogsTx(tx, {
      tenantId,
      companyId: shift.companyId,
      costCenterId: shift.costCenterId,
      sales: summary.salesByProduct.map((p) => ({ product: p.product, liters: p.liters })),
    });

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: shift.companyId,
      date: shift.shiftDate,
      memo: `إقفال وردية محطة — ${shift.shiftType} ${shift.shiftDate.toISOString().slice(0, 10)}`,
      sourceModule: "station_shift",
      sourceId: shift.id,
      createdBy: userId,
      lines: [...summary.lines, ...cogs.lines],
    });
    await createShiftFuelIssuesTx(tx, {
      tenantId,
      companyId: shift.companyId,
      shiftId: shift.id,
      date: shift.shiftDate,
      journalEntryId: entry.id,
      issues: cogs.issues,
    });
    await tx.stationShiftAuditLog.create({
      data: { tenantId, companyId: shift.companyId, shiftId, userId, action: "post", fieldName: "status", oldValue: shift.status, newValue: "posted" },
    });
    return tx.stationShift.update({ where: { id: shift.id }, data: { status: "posted", journalEntryId: entry.id } });
  });
}

/** الرفض ممكن من أي حالة قيد المراجعة أو حتى بعد الاعتماد (approved) طالما لم يُرحَّل قيد بعد —
 * بمجرد الترحيل (posted) لم يعد الرفض متاحاً إطلاقاً، لأن تصحيح خطأ بعدها يتطلب قيد عكسي لا رفضاً
 * بسيطاً (راجع الملخص المرافق). */
export async function rejectShift(tenantId: string, userId: string, shiftId: string, reasonCode: string, note: string | undefined) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (!(REJECTABLE_STATUSES as readonly string[]).includes(shift.status)) {
    throw badRequest("لا يمكن رفض وردية ليست قيد المراجعة أو الاعتماد");
  }

  return prisma.$transaction(async (tx) => {
    // مشروط بنفس الحالة المقروءة أعلاه: لو رُحِّلت الوردية بين القراءة وهذا التحديث (ترحيل متزامن)
    // لا يجوز وسم وردية ذات قيد مرحَّل بأنها "مرفوضة" — يُرفَض الطلب بدلاً من ذلك.
    const claimed = await tx.stationShift.updateMany({
      where: { id: shift.id, tenantId, status: shift.status },
      data: { status: "rejected", rejectionReasonCode: reasonCode, rejectionNote: note },
    });
    if (claimed.count !== 1) {
      throw badRequest("لا يمكن رفض وردية ليست قيد المراجعة أو الاعتماد");
    }
    const updated = await tx.stationShift.findUniqueOrThrow({ where: { id: shift.id } });
    await tx.stationShiftAuditLog.create({
      data: { tenantId, companyId: shift.companyId, shiftId, userId, action: "reject", fieldName: "status", oldValue: shift.status, newValue: "rejected" },
    });
    return updated;
  });
}

/** حالات يجوز فيها حذف الوردية نهائياً: لم تُرحَّل قط (لا قيد ولا صرف وقود). المرحَّلة والمعكوسة لا تُحذَف أبداً — أثرها في الدفاتر يبقى. */
const DELETABLE_STATUSES = ["open", "submitted", "under_review", "approved", "rejected"] as const;
/** حالات لا تحجز خانة الوردية ولا تدخل في سلسلة العدادات — نفس استثناء الفهرس الجزئي station_shifts_active_slot_key. */
const INACTIVE_SLOT_STATUSES = ["rejected", "reversed"] as const;

/**
 * حذف وردية لم تُرحَّل (تجريبية أو مُدخَلة بالخطأ) نهائياً مع قراءاتها وتحصيلها ومصروفاتها ومرفقاتها.
 *
 * الشروط: حالة ضمن DELETABLE_STATUSES، بلا قيد محاسبي، بلا حركات مخزون منسوبة إليها، لا وردية مصحَّحة تستبدلها، ولا
 * وردية لاحقة نشطة لنفس المحطة (قراءات افتتاح الوردية اللاحقة أُخذت من إغلاق هذه — حذفها يكسر سلسلة العدادات؛ تُحذَف
 * الورديات بالترتيب من الأحدث). السبب إلزامي، ويبقى صف تدقيق باسم المستخدم بعد الحذف (StationShiftAuditLog بلا مفتاح
 * أجنبي على الوردية عمداً).
 *
 * المرآة والعكس: لا ينطبقان — الوردية القابلة للحذف لا قيد لها أصلاً، فلا قيد مرآة ولا قيد عكسي يمكن أن يتعلّق بها.
 */
export async function deleteShift(tenantId: string, userId: string, shiftId: string, reasonInput: string) {
  const reason = reasonInput.trim();
  if (!reason) throw badRequest("سبب حذف الوردية مطلوب");
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (!(DELETABLE_STATUSES as readonly string[]).includes(shift.status) || shift.journalEntryId) {
    throw badRequest("لا يمكن حذف وردية مرحَّلة أو معكوسة — استخدم عكس الوردية");
  }

  const fileKeys = await prisma.$transaction(async (tx) => {
    const movements = await tx.stockMovement.count({ where: { tenantId, companyId: shift.companyId, sourceStationShiftId: shift.id } });
    if (movements > 0) throw badRequest("لا يمكن حذف وردية لها حركات مخزون — استخدم عكس الوردية");

    const replacement = await tx.stationShift.findFirst({ where: { tenantId, correctsShiftId: shift.id }, select: { id: true } });
    if (replacement) throw badRequest("لهذه الوردية وردية مصحَّحة تستبدلها — احذف الوردية المصحَّحة أولاً");

    // وردية لاحقة نشطة لنفس المحطة: تاريخ أحدث، أو نفس التاريخ والوردية الحالية صباحية واللاحقة ليلية
    if (!(INACTIVE_SLOT_STATUSES as readonly string[]).includes(shift.status)) {
      const later = await tx.stationShift.findFirst({
        where: {
          tenantId,
          companyId: shift.companyId,
          costCenterId: shift.costCenterId,
          id: { not: shift.id },
          status: { notIn: [...INACTIVE_SLOT_STATUSES] },
          OR: [
            { shiftDate: { gt: shift.shiftDate } },
            ...(shift.shiftType === "morning" ? [{ shiftDate: shift.shiftDate, shiftType: "night" as StationShiftType }] : []),
          ],
        },
        select: { id: true },
      });
      if (later) throw badRequest("توجد وردية لاحقة لنفس المحطة تعتمد على قراءات هذه الوردية — احذف الورديات الأحدث أولاً");
    }

    const readingIds = (await tx.stationShiftReading.findMany({ where: { shiftId: shift.id }, select: { id: true } })).map((r) => r.id);
    const expenseIds = (await tx.stationShiftExpense.findMany({ where: { shiftId: shift.id }, select: { id: true } })).map((e) => e.id);
    const attachmentWhere = {
      tenantId,
      OR: [
        { entityType: "station_shift_reading", entityId: { in: readingIds } },
        { entityType: "station_shift_expense", entityId: { in: expenseIds } },
      ],
    };
    const attachments = await tx.attachment.findMany({ where: attachmentWhere, select: { fileKey: true } });
    await tx.attachment.deleteMany({ where: attachmentWhere });

    // مشروط بنفس الحالة المقروءة: ترحيل متزامن بين القراءة والحذف يُفشل الحذف بدل حذف وردية مرحَّلة
    const deleted = await tx.stationShift.deleteMany({ where: { id: shift.id, tenantId, status: shift.status, journalEntryId: null } });
    if (deleted.count !== 1) throw badRequest("تغيّرت حالة الوردية أثناء الحذف — حدّث الصفحة وأعد المحاولة");

    await tx.stationShiftAuditLog.create({
      data: { tenantId, companyId: shift.companyId, shiftId: shift.id, userId, action: "delete", fieldName: "reason", oldValue: shift.status, newValue: reason },
    });
    return attachments.map((a) => a.fileKey);
  });

  // حذف ملفات المرفقات من التخزين بعد نجاح المعاملة — بأفضل جهد: فشلها لا يعيد الوردية، يترك ملفاً يتيماً فقط
  if (fileKeys.length > 0) {
    await Promise.allSettled(fileKeys.map((key) => deleteObject(key)));
  }
  return { id: shift.id, deleted: true };
}

/** الورديات المُغلَقة لشركة واحدة (الأحدث أولاً): المرحَّلة (زر عكس الوردية) والمعكوسة والمرفوضة (زر الوردية المصحَّحة). */
export async function listPostedShifts(tenantId: string, companyId?: string) {
  return prisma.stationShift.findMany({
    where: { tenantId, companyId, status: { in: ["posted", "reversed", "rejected"] }, isSeedData: false },
    include: { costCenter: true, employee: { select: { id: true, name: true } } },
    orderBy: [{ shiftDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
}

export interface ReverseShiftInput {
  reason: string;
  /** تاريخ قيد العكس (يوم بتوقيت الرياض YYYY-MM-DD) — افتراضياً اليوم. فحص إقفال الفترة يجري عند حجز رقم القيد. */
  date?: string;
}

/**
 * عكس وردية مرحَّلة — المسار الوحيد لتصحيح وردية بعد ترحيلها (العكس العام وفك الترحيل والمرآة مرفوضة لقيود
 * station_shift، راجع assertNotStationShiftEntry في journalEntries.service.ts). في معاملة واحدة: حجز الوردية
 * (posted → reversed، مشروطاً، فطلبان متزامنان لا يعكسانها مرتين)، قيد عكسي بنفس أسطر قيد الوردية بالاتجاه المعاكس
 * مربوط بـreversalOfEntryId (مصدره station_shift أيضاً حتى يبقى محمياً ويظهر في مطابقة ضريبة الورديات)، حذف حركات صرف
 * الوقود التي أنشأها ترحيلها (حركات صادرة — حذفها لا يغيّر متوسط التكلفة، فلا يلزم إعادة احتسابه)، وصفّا تدقيق
 * (الحالة، والسبب) باسم المستخدم. الوردية المعكوسة لا تُرحَّل ثانيةً أبداً (postShift يشترط approved) — تُدخَل وردية مصحَّحة.
 *
 * المرآة: يُرفَض عكس وردية لقيدها قيد مرآة (أُنشئ قبل منع المرآة لقيود الورديات) — عكسها هنا كان سيترك نصف المعاملة في
 * الشركة الأخرى قائماً. قيد عُكِس سابقاً من شاشة القيود العامة يُرفَض كذلك (لا قيد عكسي ثانٍ لنفس القيد).
 */
export async function reverseShift(tenantId: string, userId: string, shiftId: string, input: ReverseShiftInput) {
  const reason = input.reason.trim();
  if (!reason) throw badRequest("سبب عكس الوردية مطلوب");
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (shift.status !== "posted") throw badRequest("لا يمكن عكس إلا وردية مرحَّلة");
  if (!shift.journalEntryId) throw badRequest("لا قيد محاسبي مرتبط بهذه الوردية — لا يوجد ما يُعكَس");

  const entry = await prisma.journalEntry.findFirst({
    where: { id: shift.journalEntryId, tenantId, companyId: shift.companyId },
    include: { lines: true },
  });
  if (!entry) throw notFound("قيد الوردية غير موجود");
  if (entry.status !== "posted") throw badRequest("قيد الوردية ليس مرحّلاً — لا يمكن عكسها");
  if (entry.mirrorEntryId) throw badRequest("لقيد هذه الوردية قيد مرآة في شركة أخرى — لا يمكن عكسها قبل معالجة قيد المرآة");
  const alreadyReversed = await prisma.journalEntry.findFirst({ where: { tenantId, companyId: shift.companyId, reversalOfEntryId: entry.id } });
  if (alreadyReversed) throw badRequest("قيد هذه الوردية معكوس بالفعل بقيد آخر");

  // منتصف ليل UTC لليوم التقويمي — نفس اصطلاح تاريخ قيد الوردية (shiftDate) وتاريخ العكس العام (z.coerce.date لـYYYY-MM-DD).
  const date = new Date(`${input.date ?? riyadhCalendarDay(new Date())}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw badRequest("تاريخ قيد العكس غير صالح");

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.stationShift.updateMany({ where: { id: shift.id, tenantId, status: "posted" }, data: { status: "reversed" } });
    if (claimed.count !== 1) throw badRequest("لا يمكن عكس إلا وردية مرحَّلة");

    const { entryNumber, entrySeq } = await reserveEntryNumber(tx, tenantId, shift.companyId, date);
    const reversal = await tx.journalEntry.create({
      data: {
        tenantId,
        companyId: shift.companyId,
        date,
        memo: `عكس ${entry.memo ?? "قيد وردية محطة"} — ${reason}`,
        status: "posted",
        entryNumber,
        entrySeq,
        sourceModule: "station_shift",
        sourceId: shift.id,
        createdBy: userId,
        reversalOfEntryId: entry.id,
        lines: {
          create: entry.lines.map((l) => ({
            accountId: l.accountId,
            costCenterId: l.costCenterId,
            department: l.department,
            departmentId: l.departmentId,
            branchId: l.branchId,
            description: l.description,
            debit: l.credit,
            credit: l.debit,
            customerId: l.customerId,
            supplierId: l.supplierId,
            employeeId: l.employeeId,
          })),
        },
      },
    });
    await recomputeEntryTotal(tx, reversal.id);

    await tx.stockMovement.deleteMany({ where: { tenantId, companyId: shift.companyId, sourceStationShiftId: shift.id } });

    await tx.stationShiftAuditLog.createMany({
      data: [
        { tenantId, companyId: shift.companyId, shiftId, userId, action: "reverse", fieldName: "status", oldValue: "posted", newValue: "reversed" },
        { tenantId, companyId: shift.companyId, shiftId, userId, action: "reverse", fieldName: "reversalReason", oldValue: null, newValue: reason },
        { tenantId, companyId: shift.companyId, shiftId, userId, action: "reverse", fieldName: "reversalEntryId", oldValue: entry.id, newValue: reversal.id },
      ],
    });
    return tx.stationShift.findUniqueOrThrow({ where: { id: shift.id } });
  });
}

export interface CorrectedShiftInput {
  /** قراءة الإغلاق المصحَّحة لكل فوهة قُرئت في الوردية المستبدَلة — افتتاحها يُؤخذ من افتتاح تلك الوردية، لا من الطلب. */
  readings: { nozzleId: string; closingReading: number; testLiters?: number }[];
  /** التحصيل المصحَّح؛ إن غاب يُنسخ تحصيل الوردية المستبدَلة كما هو. */
  collection?: { networkAmount: number; fuelCardAmount: number; cashDelivered: number };
}

export const CORRECTED_SHIFT_CHAIN_MISMATCH =
  "قراءة إغلاق الوردية المصحَّحة لا تطابق قراءة افتتاح الوردية التالية لنفس المحطة — اعكس الورديات اللاحقة وصحّحها بالترتيب أولاً";

/**
 * وردية مصحَّحة يُدخلها المحاسب (بصلاحية الترحيل) بدل وردية معكوسة أو مرفوضة، بنفس المحطة والتاريخ ونوع الوردية — المسار
 * الوحيد لإدخال وردية بتاريخ سابق (فتح العامل يأخذ تاريخ اليوم دائماً). الخانة تكون حرّة لأن الفهرس الجزئي يستثني
 * المرفوضة والمعكوسة؛ وردية قائمة في نفس الخانة تُرفَض (والفهرس يرفض السباق).
 *
 * قراءات الافتتاح = افتتاح الوردية المستبدَلة لكل فوهة (هو إغلاق ما قبلها في سلسلة العداد)، لا إغلاقها. سلامة السلسلة: إن
 * وُجدت وردية لاحقة قائمة لنفس المحطة (غير مرفوضة ولا معكوسة)، فقراءة إغلاق كل فوهة هنا يجب أن تساوي افتتاح تلك الفوهة
 * في الوردية اللاحقة — وإلا يُرفَض الطلب: الورديات اللاحقة تُعكَس وتُصحَّح بالترتيب أولاً.
 *
 * تُنسَخ المبيعات الآجلة والمصروفات من الوردية المستبدَلة، والتحصيل كذلك ما لم يُرسَل تصحيحه. تبدأ الوردية "قيد
 * المراجعة" وقيم المحاسب مُدخَلة، ثم تمرّ بالمسار المعتاد: مراجعة → اعتماد → ترحيل. صور العدادات: صور الوردية المستبدَلة
 * لنفس الفوهة تُقبَل إثباتاً عند الاعتماد (approveShift)، أو تُرفَع صورة جديدة على القراءة المصحَّحة.
 */
export async function createCorrectedShift(tenantId: string, userId: string, replacedShiftId: string, input: CorrectedShiftInput) {
  const replaced = await prisma.stationShift.findFirst({
    where: { id: replacedShiftId, tenantId },
    include: { readings: { include: { nozzle: true } }, collection: true, creditSales: true, expenses: true },
  });
  if (!replaced) throw notFound("الوردية غير موجودة");
  if (!(SLOT_FREEING_STATUSES as readonly string[]).includes(replaced.status)) {
    throw badRequest("الوردية المصحَّحة تُدخَل فقط بدل وردية معكوسة أو مرفوضة");
  }
  if (!replaced.readings.length) throw badRequest("الوردية المستبدَلة بلا قراءات عدادات — لا يمكن إدخال وردية مصحَّحة بدلاً منها");

  const occupied = await prisma.stationShift.findFirst({
    where: { tenantId, costCenterId: replaced.costCenterId, shiftDate: replaced.shiftDate, shiftType: replaced.shiftType, status: { notIn: [...SLOT_FREEING_STATUSES] } },
  });
  if (occupied) throw badRequest("توجد وردية بالفعل لهذه المحطة بنفس التاريخ ونوع الوردية");

  const closingByNozzle = new Map(input.readings.map((r) => [r.nozzleId, r]));
  if (closingByNozzle.size !== input.readings.length) throw badRequest("قراءة مكررة لنفس الفوهة في الوردية المصحَّحة");
  const replacedNozzles = new Set(replaced.readings.map((r) => r.nozzleId));
  if (input.readings.some((r) => !replacedNozzles.has(r.nozzleId)) || replaced.readings.some((r) => !closingByNozzle.has(r.nozzleId))) {
    throw badRequest("أدخل قراءة إغلاق مصحَّحة لكل فوهة قُرئت في الوردية المستبدَلة، ولا غيرها");
  }

  const corrected = replaced.readings.map((r) => {
    const given = closingByNozzle.get(r.nozzleId)!;
    const closing = new Prisma.Decimal(given.closingReading);
    const testLiters = new Prisma.Decimal(given.testLiters ?? r.testLiters);
    // نفس فحص اللفّة والمعقولية المطبَّق على تصحيح المحاسب العادي (correctReading)
    computeNozzleLiters({
      nozzleId: r.nozzleId, label: `${r.nozzle.pumpNumber}-${r.nozzle.nozzleNumber}`, product: r.nozzle.product,
      meterDigits: r.nozzle.meterDigits, openingReading: r.openingReading, closingReading: closing, testLiters,
    });
    return { reading: r, closing, testLiters };
  });

  // الوردية القائمة التالية مباشرة لنفس المحطة (تاريخ لاحق، أو نفس اليوم ونوع لاحق: صباحية ثم مسائية)
  const later = await prisma.stationShift.findFirst({
    where: {
      tenantId, costCenterId: replaced.costCenterId, status: { notIn: [...SLOT_FREEING_STATUSES] },
      OR: [{ shiftDate: { gt: replaced.shiftDate } }, ...(replaced.shiftType === "morning" ? [{ shiftDate: replaced.shiftDate, shiftType: "night" as const }] : [])],
    },
    orderBy: [{ shiftDate: "asc" }, { shiftType: "asc" }, { createdAt: "asc" }],
    include: { readings: true },
  });
  if (later) {
    const laterOpening = new Map(later.readings.map((r) => [r.nozzleId, new Prisma.Decimal(r.openingReading)]));
    const mismatches = corrected
      .filter((c) => laterOpening.has(c.reading.nozzleId) && !laterOpening.get(c.reading.nozzleId)!.equals(c.closing))
      .map((c) => ({
        nozzle: `${c.reading.nozzle.pumpNumber}-${c.reading.nozzle.nozzleNumber}`,
        closingReading: c.closing.toString(),
        laterShiftOpeningReading: laterOpening.get(c.reading.nozzleId)!.toString(),
      }));
    if (mismatches.length) throw badRequest(CORRECTED_SHIFT_CHAIN_MISMATCH, { laterShiftId: later.id, mismatches });
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.stationShift.create({
      data: {
        tenantId, companyId: replaced.companyId, costCenterId: replaced.costCenterId, employeeId: replaced.employeeId,
        shiftDate: replaced.shiftDate, shiftType: replaced.shiftType, openedAt: replaced.openedAt, closedAt: replaced.closedAt ?? new Date(),
        status: "under_review", isSeedData: false, correctsShiftId: replaced.id,
      },
    });
    await tx.stationShiftReading.createMany({
      data: corrected.map((c) => ({
        tenantId, companyId: replaced.companyId, shiftId: shift.id, nozzleId: c.reading.nozzleId,
        openingReading: c.reading.openingReading, testLiters: c.testLiters, accountantConfirmedValue: c.closing,
        capturedAt: c.reading.capturedAt, latitude: c.reading.latitude, longitude: c.reading.longitude,
      })),
    });
    const collection = input.collection ?? replaced.collection;
    if (collection) {
      await tx.stationShiftCollection.create({
        data: {
          tenantId, companyId: replaced.companyId, shiftId: shift.id,
          networkAmount: collection.networkAmount, fuelCardAmount: collection.fuelCardAmount, cashDelivered: collection.cashDelivered,
        },
      });
    }
    if (replaced.creditSales.length) {
      await tx.stationShiftCreditSale.createMany({
        data: replaced.creditSales.map((c) => ({ tenantId, companyId: replaced.companyId, shiftId: shift.id, customerId: c.customerId, amount: c.amount, voucherNumber: c.voucherNumber })),
      });
    }
    if (replaced.expenses.length) {
      await tx.stationShiftExpense.createMany({
        data: replaced.expenses.map((e) => ({ tenantId, companyId: replaced.companyId, shiftId: shift.id, amount: e.amount, category: e.category, description: e.description })),
      });
    }
    await tx.stationShiftAuditLog.createMany({
      data: [
        { tenantId, companyId: replaced.companyId, shiftId: shift.id, userId, action: "create_corrected", fieldName: "correctsShiftId", oldValue: null, newValue: replaced.id },
        { tenantId, companyId: replaced.companyId, shiftId: replaced.id, userId, action: "corrected_by", fieldName: "correctedShiftId", oldValue: null, newValue: shift.id },
      ],
    });
    return tx.stationShift.findUniqueOrThrow({ where: { id: shift.id }, include: { readings: true } });
  });
}
