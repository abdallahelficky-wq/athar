import { Prisma, StationFuelProduct, StationShiftType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound, forbidden, HttpError } from "../../lib/httpError";
import { createJournalEntryTx, type PostingLine } from "../../lib/journalPosting";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";

/** أي قيمة يقبلها مُنشئ Prisma.Decimal — نص أو رقم أو Decimal جاهز. */
type DecimalInput = Prisma.Decimal.Value;

// ضريبة القيمة المضافة 15% — السعر عند المضخة يشملها دائماً (priceInclVat)، وفق القسم 4 من هذه
// المواصفة صراحة؛ ليست إعداداً قابلاً للتخصيص هنا.
const VAT_DIVISOR = new Prisma.Decimal("1.15");

export interface NozzleReadingInput {
  nozzleId: string;
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
export function computeNozzleLiters(reading: NozzleReadingInput): Prisma.Decimal {
  const opening = new Prisma.Decimal(reading.openingReading);
  let closing = new Prisma.Decimal(reading.closingReading);
  if (closing.lessThan(opening)) {
    closing = closing.plus(new Prisma.Decimal(10).pow(reading.meterDigits));
  }
  const liters = closing.minus(opening).minus(new Prisma.Decimal(reading.testLiters));
  if (liters.isNegative()) {
    throw badRequest(`قراءة العداد غير صحيحة للفوهة (${reading.nozzleId}): الكمية المحسوبة سالبة حتى بعد افتراض دورة كاملة للعداد`);
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
    const netAmount = amount.dividedBy(VAT_DIVISOR).toDecimalPlaces(2);
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
async function getOwnedOpenShift(tenantId: string, userId: string, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (shift.employeeUserId !== userId) throw forbidden("هذه الوردية ليست لك");
  assertShiftOpenForWorker(shift);
  return shift;
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
    closingByNozzle.set(reading.nozzleId, new Prisma.Decimal(reading.accountantConfirmedValue ?? reading.closingReading));
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
 * تحلّل كل الحسابات المحاسبية المطلوبة لترحيل قيد إقفال وردية محطة، بأسماء قياسية (عبر
 * getAccountIdByName — تتوافق مع أي قالب شجرة حسابات وليس فقط قالب "محطات وقود" مباشرة، طالما
 * الأسماء البديلة مسجَّلة في wellKnownAccounts.ts). قرارات اتُخذت هنا بلا نص صريح من أحد (راجع
 * الملخص المرافق):
 *   - شبكة نقاط البيع وبطاقات الوقود تُقيَّدان على نفس حساب "ذمم شركات بطاقات الوقود/الأسطول"
 *     الوحيد — قالب "محطات وقود" لا يحمل حساب ذمم شبكة منفصلاً.
 *   - عجز/زيادة الصندوق يُقيَّدان على "مصروفات إدارية عامة أخرى"/"إيرادات متنوعة أخرى" — لا يوجد
 *     حساب "فروقات صندوق" مخصَّص في أي قالب حالياً.
 *   - كل بنود StationShiftExpense (بصرف النظر عن category الحر) تُقيَّد على نفس حساب "مصروفات
 *     إدارية عامة أخرى" أيضاً — category نص وصفي فقط حالياً، لا مُحدِّد حساب.
 */
async function resolveShiftClosingAccounts(tenantId: string, companyId: string) {
  const [
    cashAccountId,
    dieselRevenueAccountId,
    gasoline91RevenueAccountId,
    gasoline95RevenueAccountId,
    outputVatAccountId,
    cardReceivableAccountId,
    otherExpenseAccountId,
    otherRevenueAccountId,
  ] = await Promise.all([
    getAccountIdByName(tenantId, companyId, "صندوق نثرية الفروع/المواقع"),
    tryResolveAccountIdByName(tenantId, companyId, "إيراد مبيعات ديزل"),
    tryResolveAccountIdByName(tenantId, companyId, "إيراد مبيعات بنزين 91"),
    tryResolveAccountIdByName(tenantId, companyId, "إيراد مبيعات بنزين 95"),
    getAccountIdByName(tenantId, companyId, "ضريبة القيمة المضافة - مخرجات"),
    getAccountIdByName(tenantId, companyId, "ذمم شركات بطاقات الوقود/الأسطول"),
    getAccountIdByName(tenantId, companyId, "مصروفات إدارية عامة أخرى"),
    getAccountIdByName(tenantId, companyId, "إيرادات متنوعة أخرى"),
  ]);

  const accounts: ShiftClosingAccounts = {
    cashAccountId,
    revenueAccountByProduct: {
      diesel: dieselRevenueAccountId,
      gasoline_91: gasoline91RevenueAccountId,
      gasoline_95: gasoline95RevenueAccountId,
    },
    outputVatAccountId,
    networkReceivableAccountId: cardReceivableAccountId,
    fuelCardReceivableAccountId: cardReceivableAccountId,
    cashShortageAccountId: otherExpenseAccountId,
    cashSurplusAccountId: otherRevenueAccountId,
  };
  return { accounts, expenseAccountId: otherExpenseAccountId };
}

/** يبني مدخل computeShiftClosing الكامل من سجلات وردية حقيقية — نقطة التقاء واحدة يستخدمها كل من
 * ملخص العامل الحي (GET summary) وتفاصيل المحاسب (GET :id) وخطوة الاعتماد الفعلية، فلا يتكرر
 * منطق التحميل بثلاث نسخ قد تنحرف عن بعضها لاحقاً. */
async function loadShiftClosingInput(tenantId: string, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({
    where: { id: shiftId, tenantId },
    include: { readings: { include: { nozzle: true } }, creditSales: true, expenses: true, collection: true },
  });
  if (!shift) throw notFound("الوردية غير موجودة");

  const [priceRows, { accounts, expenseAccountId }] = await Promise.all([
    prisma.fuelPrice.findMany({ where: { OR: [{ costCenterId: shift.costCenterId }, { costCenterId: null }] } }),
    resolveShiftClosingAccounts(shift.tenantId, shift.companyId),
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

  const input: ShiftClosingInput = {
    costCenterId: shift.costCenterId,
    shiftDate: shift.shiftDate,
    readings: shift.readings.map((reading) => ({
      nozzleId: reading.nozzleId,
      product: reading.nozzle.product,
      meterDigits: reading.nozzle.meterDigits,
      openingReading: reading.openingReading,
      // تصحيح المحاسب (إن وُجد) هو القيمة المعتمَدة فعلياً للحساب المالي — القراءة الأصلية تبقى
      // محفوظة بلا تعديل للتدقيق التاريخي فقط.
      closingReading: reading.accountantConfirmedValue ?? reading.closingReading,
      testLiters: reading.testLiters,
    })),
    prices: priceRows,
    networkAmount: shift.collection?.networkAmount ?? 0,
    fuelCardAmount: shift.collection?.fuelCardAmount ?? 0,
    cashDelivered: shift.collection?.cashDelivered ?? 0,
    creditSales,
    expenses: shift.expenses.map((expense) => ({ accountId: expenseAccountId, amount: expense.amount })),
    accounts,
  };
  return { shift, input };
}

/** المحطة (مركز التكلفة) المُسنَدة لمستخدم عامل — تُشتَق من User.assignedCostCenterId حصراً، لا
 * من أي مدخل في الطلب، وفق القاعدة الصارمة: عامل لا يصل إلا لمحطته المُسنَدة. */
async function getWorkerCostCenter(tenantId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { assignedCostCenterId: true } });
  if (!user?.assignedCostCenterId) throw badRequest("لا توجد محطة مُسنَدة لهذا المستخدم");
  const costCenter = await prisma.costCenter.findUnique({ where: { id: user.assignedCostCenterId }, select: { id: true, companyId: true } });
  if (!costCenter?.companyId) throw badRequest("محطة بلا شركة محددة، لا يمكن فتح وردية عليها");
  return { costCenterId: costCenter.id, companyId: costCenter.companyId };
}

/** بيانات نقطة "محطتي" — نوافذ العامل قبل فتح وردية جديدة: قائمة الفوهات، الأسعار السارية اليوم
 * (فارغة/null لمنتج بلا سعر مضبوط بعد بدل رفض الشاشة بالكامل — عرض فقط، لا التزام مالي)، وقراءات
 * إغلاق آخر وردية سابقة لكل فوهة (نفس ما سيُشتَق منه openingReading تلقائياً عند فتح وردية جديدة).
 */
export async function getMyStation(tenantId: string, userId: string) {
  const { costCenterId } = await getWorkerCostCenter(tenantId, userId);

  const [nozzles, priceRows] = await Promise.all([
    prisma.stationNozzle.findMany({ where: { costCenterId, isActive: true }, orderBy: [{ pumpNumber: "asc" }, { nozzleNumber: "asc" }] }),
    prisma.fuelPrice.findMany({ where: { OR: [{ costCenterId }, { costCenterId: null }] } }),
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
  const previousClosingReadings = Object.fromEntries([...closingByNozzle].map(([nozzleId, value]) => [nozzleId, value.toNumber()]));

  return { costCenterId, nozzles, effectivePrices, previousShiftId: previousShift?.id ?? null, previousClosingReadings };
}

export interface OpenShiftInput {
  shiftType: StationShiftType;
}

/** فتح وردية جديدة — costCenterId يُشتَق دائماً من تعيين المستخدم نفسه (لا من الطلب إطلاقاً)،
 * وshiftDate هو تاريخ اليوم الحالي (منتصف الليل UTC) لحظة الفتح، لا قيمة يختارها العامل. القيد
 * الفريد (costCenterId, shiftDate, shiftType) يمنع فتح وردية مكررة لنفس المحطة/اليوم/النوع —
 * يُتحقَّق منه هنا صراحة برسالة واضحة بدل الاعتماد على رسالة قيد قاعدة البيانات العامة فقط.
 */
export async function openShift(tenantId: string, userId: string, input: OpenShiftInput) {
  const { costCenterId, companyId } = await getWorkerCostCenter(tenantId, userId);
  const shiftDate = new Date();
  shiftDate.setUTCHours(0, 0, 0, 0);

  const existing = await prisma.stationShift.findUnique({
    where: { costCenterId_shiftDate_shiftType: { costCenterId, shiftDate, shiftType: input.shiftType } },
  });
  if (existing) throw badRequest("توجد وردية بالفعل لهذه المحطة بنفس التاريخ ونوع الوردية");

  return prisma.stationShift.create({
    data: { tenantId, companyId, costCenterId, employeeUserId: userId, shiftDate, shiftType: input.shiftType, openedAt: new Date(), status: "open" },
  });
}

export interface SubmitReadingInput {
  nozzleId: string;
  closingReading: number;
  testLiters: number;
  workerConfirmedValue: number;
  capturedAt: Date;
  latitude?: number;
  longitude?: number;
}

/** إضافة/تعديل قراءة فوهة واحدة ضمن وردية العامل المفتوحة — openingReading يُشتَق دائماً من
 * قراءة الإغلاق في آخر وردية سابقة لنفس الفوهة (صفر لو أول وردية إطلاقاً)، ولا يُقبَل إطلاقاً من
 * الطلب (stationShifts.schemas.ts لا يعرّف هذا الحقل أصلاً ويرفض .strict() أي محاولة لتمريره).
 * تُرفَض القراءة فوراً بنفس منطق computeNozzleLiters الخالص (لا عند التلخيص/الاعتماد لاحقاً فقط)
 * لو ظلّت سالبة حتى بعد افتراض لفّة كاملة للعداد. upsert بدل create: العامل قد يعيد إرسال نفس
 * الفوهة أكثر من مرة قبل الإرسال النهائي (submit) لتصحيح خطأ إدخال بنفسه.
 */
export async function submitReading(tenantId: string, userId: string, shiftId: string, input: SubmitReadingInput) {
  const shift = await getOwnedOpenShift(tenantId, userId, shiftId);

  const nozzle = await prisma.stationNozzle.findFirst({
    where: { id: input.nozzleId, costCenterId: shift.costCenterId, tenantId, isActive: true },
  });
  if (!nozzle) throw badRequest("الفوهة غير موجودة أو لا تتبع محطة هذه الوردية");

  const { closingByNozzle } = await getPreviousClosingReadings(tenantId, shift.costCenterId, shift.id);
  const openingReading = closingByNozzle.get(nozzle.id) ?? new Prisma.Decimal(0);

  computeNozzleLiters({
    nozzleId: nozzle.id,
    product: nozzle.product,
    meterDigits: nozzle.meterDigits,
    openingReading,
    closingReading: input.closingReading,
    testLiters: input.testLiters,
  });

  return prisma.stationShiftReading.upsert({
    where: { shiftId_nozzleId: { shiftId: shift.id, nozzleId: nozzle.id } },
    create: {
      tenantId,
      companyId: shift.companyId,
      shiftId: shift.id,
      nozzleId: nozzle.id,
      openingReading,
      closingReading: input.closingReading,
      testLiters: input.testLiters,
      workerConfirmedValue: input.workerConfirmedValue,
      capturedAt: input.capturedAt,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    update: {
      closingReading: input.closingReading,
      testLiters: input.testLiters,
      workerConfirmedValue: input.workerConfirmedValue,
      capturedAt: input.capturedAt,
      latitude: input.latitude,
      longitude: input.longitude,
    },
  });
}

export interface UpdateCollectionsInput {
  networkAmount: number;
  fuelCardAmount: number;
  cashDelivered: number;
}

export async function updateCollections(tenantId: string, userId: string, shiftId: string, input: UpdateCollectionsInput) {
  const shift = await getOwnedOpenShift(tenantId, userId, shiftId);
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

export async function addCreditSale(tenantId: string, userId: string, shiftId: string, input: AddCreditSaleInput) {
  const shift = await getOwnedOpenShift(tenantId, userId, shiftId);
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: shift.companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");
  return prisma.stationShiftCreditSale.create({ data: { tenantId, companyId: shift.companyId, shiftId: shift.id, ...input } });
}

export interface AddExpenseInput {
  amount: number;
  category: string;
  description?: string;
}

export async function addExpense(tenantId: string, userId: string, shiftId: string, input: AddExpenseInput) {
  const shift = await getOwnedOpenShift(tenantId, userId, shiftId);
  return prisma.stationShiftExpense.create({ data: { tenantId, companyId: shift.companyId, shiftId: shift.id, ...input } });
}

/** الملخص الحسابي الحي لوردية — يعمل حتى وهي لا تزال open وناقصة القراءات (ملخّص جزئي مفيد
 * للعامل نفسه قبل الإرسال)، عبر نفس computeShiftClosing الخالصة تماماً المستخدَمة عند الاعتماد
 * الفعلي لاحقاً — رقم واحد لا رقمان قد ينحرفان عن بعضهما. */
export async function getShiftSummary(tenantId: string, shiftId: string) {
  const { input } = await loadShiftClosingInput(tenantId, shiftId);
  return computeShiftClosing(input);
}

export async function submitShift(tenantId: string, userId: string, shiftId: string) {
  const shift = await getOwnedOpenShift(tenantId, userId, shiftId);
  return prisma.stationShift.update({ where: { id: shift.id }, data: { status: "submitted", closedAt: new Date() } });
}

const PENDING_STATUSES = ["submitted", "under_review"] as const;

export async function listPendingShifts(tenantId: string, companyId?: string) {
  return prisma.stationShift.findMany({
    where: { tenantId, companyId, status: { in: [...PENDING_STATUSES] } },
    include: { costCenter: true, employeeUser: { select: { id: true, name: true } } },
    orderBy: { shiftDate: "asc" },
  });
}

/** تفاصيل وردية كاملة لشاشة المحاسب: السجل الخام (قراءات/تحصيل/مبيعات آجلة/مصروفات/سجل تدقيق)
 * بالإضافة إلى نفس الملخص الحي المحسوب لـ getShiftSummary — فلا يحتاج المحاسب استدعاء نقطة نهاية
 * العامل summary لرؤية نفس الأرقام. */
export async function getShiftById(tenantId: string, shiftId: string) {
  const { shift, input } = await loadShiftClosingInput(tenantId, shiftId);
  const [summary, auditLogs] = await Promise.all([
    computeShiftClosing(input),
    prisma.stationShiftAuditLog.findMany({ where: { shiftId }, orderBy: { createdAt: "desc" } }),
  ]);
  return { ...shift, summary, auditLogs };
}

/** تصحيح المحاسب لقراءة عداد واحدة أثناء المراجعة — يكتب دائماً صفاً في StationShiftAuditLog
 * (لا استثناء)، ويحوّل حالة الوردية إلى under_review تلقائياً لو كانت لا تزال submitted فقط
 * (أول تصحيح يبدأ "قيد المراجعة" فعلياً؛ التصحيحات التالية لا تُعيد هذا التحويل). القيمة
 * المصحَّحة (accountantConfirmedValue) هي ما يدخل الحساب المالي فعلياً بدل closingReading
 * الأصلية — راجع تعليق loadShiftClosingInput أعلاه.
 */
export async function correctReading(tenantId: string, userId: string, shiftId: string, readingId: string, accountantConfirmedValue: number) {
  const reading = await prisma.stationShiftReading.findFirst({
    where: { id: readingId, shiftId, tenantId },
    include: { shift: true },
  });
  if (!reading) throw notFound("القراءة غير موجودة");
  if (!(PENDING_STATUSES as readonly string[]).includes(reading.shift.status)) {
    throw badRequest("لا يمكن تصحيح قراءة لوردية ليست قيد المراجعة");
  }

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

/** اعتماد وردية وترحيل قيدها المحاسبي تلقائياً في نفس الخطوة الواحدة — لا حالة "approved" منفصلة
 * فعلياً مخزَّنة قبل الترحيل رغم وجودها في enum الحالات (راجع الملخص المرافق): "المحاسب يراجع
 * ويعتمد، ويُنشأ قيد تلقائياً" وردت كخطوة واحدة، لا خطوتين. يُرفَض الاعتماد كاملاً (قبل أي كتابة)
 * لو نقصت قراءة فوهة نشطة واحدة، أو نقصت صورة عداد (Attachment) لقراءة موجودة فعلاً.
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

  const readingIds = readings.map((r) => r.id);
  const attachedReadingIds = readingIds.length
    ? await prisma.attachment.findMany({
        where: { tenantId, entityType: "station_shift_reading", entityId: { in: readingIds } },
        select: { entityId: true },
      })
    : [];
  const withPhoto = new Set(attachedReadingIds.map((a) => a.entityId));
  for (const reading of readings) {
    if (!withPhoto.has(reading.id)) throw badRequest("لا يمكن اعتماد الوردية: إحدى القراءات بلا صورة عداد مرفقة بعد");
  }

  const { input } = await loadShiftClosingInput(tenantId, shiftId);
  const summary = computeShiftClosing(input);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: shift.companyId,
      date: shift.shiftDate,
      memo: `إقفال وردية محطة — ${shift.shiftType} ${shift.shiftDate.toISOString().slice(0, 10)}`,
      sourceModule: "station_shift",
      sourceId: shift.id,
      createdBy: userId,
      lines: summary.lines,
    });
    await tx.stationShiftAuditLog.create({
      data: { tenantId, companyId: shift.companyId, shiftId, userId, action: "approve", fieldName: "status", oldValue: shift.status, newValue: "posted" },
    });
    return tx.stationShift.update({ where: { id: shift.id }, data: { status: "posted", journalEntryId: entry.id } });
  });
}

export async function rejectShift(tenantId: string, userId: string, shiftId: string, reasonCode: string, note: string | undefined) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw notFound("الوردية غير موجودة");
  if (!(PENDING_STATUSES as readonly string[]).includes(shift.status)) {
    throw badRequest("لا يمكن رفض وردية ليست قيد المراجعة");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.stationShift.update({
      where: { id: shift.id },
      data: { status: "rejected", rejectionReasonCode: reasonCode, rejectionNote: note },
    });
    await tx.stationShiftAuditLog.create({
      data: { tenantId, companyId: shift.companyId, shiftId, userId, action: "reject", fieldName: "status", oldValue: shift.status, newValue: "rejected" },
    });
    return updated;
  });
}
