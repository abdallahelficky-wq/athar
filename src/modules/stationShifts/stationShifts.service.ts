import { Prisma, StationFuelProduct } from "@prisma/client";
import { badRequest } from "../../lib/httpError";
import type { PostingLine } from "../../lib/journalPosting";

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
  /** إيراد بيع الوقود بالصافي (بدون ضريبة). */
  revenueAccountId: string;
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
  amount: Prisma.Decimal;
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
function computeNozzleLiters(reading: NozzleReadingInput): Prisma.Decimal {
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
function resolveEffectivePrice(product: StationFuelProduct, shiftDate: Date, prices: FuelPriceInput[]): Prisma.Decimal {
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

  const salesByProduct: ProductSalesResult[] = [];
  let grossSales = new Prisma.Decimal(0);
  for (const [product, liters] of litersByProduct) {
    if (liters.isZero()) {
      salesByProduct.push({ product, liters, priceInclVat: null, amount: new Prisma.Decimal(0) });
      continue;
    }
    const priceInclVat = resolveEffectivePrice(product, input.shiftDate, input.prices);
    const amount = liters.times(priceInclVat).toDecimalPlaces(2);
    grossSales = grossSales.plus(amount);
    salesByProduct.push({ product, liters, priceInclVat, amount });
  }
  grossSales = grossSales.toDecimalPlaces(2);

  // مبلغ الفاتورة (شامل الضريبة) ÷ 1.15 = الصافي؛ الضريبة = الفرق — لا قسمة مستقلة للضريبة، حتى
  // يبقى الصافي + الضريبة مساوياً لإجمالي المبيعات تماماً مهما كان أثر التقريب.
  const revenueExclVat = grossSales.dividedBy(VAT_DIVISOR).toDecimalPlaces(2);
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

  pushLine(input.accounts.revenueAccountId, new Prisma.Decimal(0), revenueExclVat);
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
