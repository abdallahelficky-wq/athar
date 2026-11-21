/**
 * محرّك حساب الوعاء الزكوي — دالة نقية بالهللات (أعداد صحيحة). المرجع: اللائحة التنفيذية لجباية الزكاة 1445هـ والدليل
 * الإرشادي لأبرز تعديلاتها (هيئة الزكاة والضريبة والجمارك، أبريل 2024).
 *
 * طريقة اللائحة (regulation_1445):
 *   الإضافة: حقوق الملكية وما في حكمها (برصيد آخر المدة، ومنها المخصصات عدا نهاية الخدمة والإجازات)
 *            + فرق صافي الربح المعدل عن الدفتري
 *            + الالتزامات غير المتداولة (ومنها مخصصا نهاية الخدمة والإجازات) — مستبعداً منها بالتنسيب ما يقابل الأصول
 *              غير المتداولة غير المحسومة: (الأصل غير المتداول غير المحسوم ÷ إجمالي غير المتداولة) × الالتزامات غير المتداولة،
 *              بحد أقصى قيمة الأصل غير المحسوم
 *            + الالتزامات المتداولة بالتنسيب لما يُحسم من أصول متداولة: (المتداول المحسوم ÷ إجمالي المتداولة) × الالتزامات
 *              المتداولة، بحد أقصى قيمة المتداول المحسوم
 *            — ومجموع الالتزامات المضافة لا يتجاوز مجموع المحسوم.
 *   الحسم:   الأصول غير المتداولة المقتناة للاستخدام + أصول متداولة محسومة (قطع غيار/مواد غير معدّة للبيع…) بتصنيف المستخدم.
 *   الحد الأعلى: حقوق الملكية وما في حكمها + فرق الربح المعدل عن الدفتري.
 *   الحد الأدنى: إن نقص الوعاء عن صافي الربح المعدل ⇒ الأقل من (الأصول غير المحسومة + فرق الربح) و(صافي الربح المعدل).
 *                وعاء سالب بلا ربح معدل ⇒ صفر.
 * طريقة صافي الأصول المتداولة (net_current_assets): الأصول المتداولة − الالتزامات المتداولة + فرق الربح المعدل، ولا تقل عن صفر.
 *
 * النسبة: 2.5% للسنة الهجرية؛ لغيرها (ميلادية أو فترة ناقصة) = 2.5% ÷ 354 × أيام السنة المالية.
 * حصة الملكية الخاضعة للزكاة (السعوديين/الخليجيين) تُطبَّق على الزكاة المستحقة.
 * كل بند قابل للمراجعة: التصنيف من شجرة الحسابات (zakatTreatment)، والتسويات بنود يدوية — الحساب لا يخمّن نيابةً عن المكلف.
 */
export type ZakatMethod = "regulation_1445" | "net_current_assets";

export interface ZakatInputs {
  method: ZakatMethod;
  /** حقوق الملكية وما في حكمها (شاملة صافي ربح/خسارة الفترات غير المقفلة والمخصصات المعاملة كحقوق ملكية) */
  equity: number;
  nonCurrentLiabilities: number;
  currentLiabilities: number;
  deductibleNonCurrentAssets: number;
  nonDeductibleNonCurrentAssets: number;
  deductibleCurrentAssets: number;
  nonDeductibleCurrentAssets: number;
  bookNetProfit: number;
  /** مجموع تسويات صافي الربح (موجبة تزيده) */
  profitAdjustments: number;
  periodDays: number;
  hijriYear: boolean;
  /** نسبة الملكية الخاضعة للزكاة 0..100 */
  zakatableOwnershipPct: number;
}

export interface ZakatResult {
  adjustedNetProfit: number;
  profitDifference: number;
  nonCurrentLiabilitiesExcluded: number;
  nonCurrentLiabilitiesAdded: number;
  currentLiabilitiesAdded: number;
  totalDeductions: number;
  baseBeforeLimits: number;
  maxBase: number;
  minBaseApplied: boolean;
  maxBaseApplied: boolean;
  zakatBase: number;
  /** النسبة بأجزاء من مليون (25000 = 2.5%) */
  ratePpm: number;
  zakatBeforeOwnership: number;
  zakatDue: number;
}

const HIJRI_YEAR_DAYS = 354;
const BASE_RATE_PPM = 25_000; // 2.5%

const prorate = (part: number, whole: number, amount: number) => (whole > 0 ? Math.round((part / whole) * amount) : 0);
const clamp0 = (n: number) => Math.max(0, n);

export function zakatRatePpm(periodDays: number, hijriYear: boolean): number {
  if (hijriYear) return BASE_RATE_PPM;
  return Math.round((BASE_RATE_PPM / HIJRI_YEAR_DAYS) * periodDays);
}

export function computeZakat(i: ZakatInputs): ZakatResult {
  const adjustedNetProfit = i.bookNetProfit + i.profitAdjustments;
  const profitDifference = i.profitAdjustments;
  const ratePpm = zakatRatePpm(i.periodDays, i.hijriYear);

  let nonCurrentLiabilitiesExcluded = 0;
  let nonCurrentLiabilitiesAdded = 0;
  let currentLiabilitiesAdded = 0;
  let totalDeductions = 0;
  let baseBeforeLimits: number;
  let maxBase = 0;
  let zakatBase: number;
  let minBaseApplied = false;
  let maxBaseApplied = false;

  if (i.method === "net_current_assets") {
    const currentAssets = i.deductibleCurrentAssets + i.nonDeductibleCurrentAssets;
    baseBeforeLimits = currentAssets - i.currentLiabilities + profitDifference;
    zakatBase = clamp0(baseBeforeLimits);
  } else {
    const totalNonCurrent = i.deductibleNonCurrentAssets + i.nonDeductibleNonCurrentAssets;
    const totalCurrent = i.deductibleCurrentAssets + i.nonDeductibleCurrentAssets;
    const ncl = clamp0(i.nonCurrentLiabilities);
    const cl = clamp0(i.currentLiabilities);
    nonCurrentLiabilitiesExcluded = Math.min(prorate(clamp0(i.nonDeductibleNonCurrentAssets), totalNonCurrent, ncl), clamp0(i.nonDeductibleNonCurrentAssets));
    if (totalNonCurrent <= 0) nonCurrentLiabilitiesExcluded = ncl; // لا أصول غير متداولة محسومة تقابلها
    const nclAdded = ncl - nonCurrentLiabilitiesExcluded;
    const clAdded = Math.min(prorate(clamp0(i.deductibleCurrentAssets), totalCurrent, cl), clamp0(i.deductibleCurrentAssets));
    totalDeductions = clamp0(i.deductibleNonCurrentAssets) + clamp0(i.deductibleCurrentAssets);
    // سقف: مجموع الالتزامات المضافة لا يتجاوز مجموع المحسوم
    const addedTotal = Math.min(nclAdded + clAdded, totalDeductions);
    const scale = nclAdded + clAdded > 0 ? addedTotal / (nclAdded + clAdded) : 0;
    nonCurrentLiabilitiesAdded = Math.round(nclAdded * scale);
    currentLiabilitiesAdded = addedTotal - nonCurrentLiabilitiesAdded;

    baseBeforeLimits = i.equity + profitDifference + nonCurrentLiabilitiesAdded + currentLiabilitiesAdded - totalDeductions;
    maxBase = i.equity + profitDifference;
    zakatBase = baseBeforeLimits;
    if (zakatBase > maxBase) {
      zakatBase = maxBase;
      maxBaseApplied = true;
    }
    if (adjustedNetProfit > 0 && zakatBase < adjustedNetProfit) {
      const nonDeducted = clamp0(i.nonDeductibleNonCurrentAssets) + clamp0(i.nonDeductibleCurrentAssets);
      zakatBase = Math.min(nonDeducted + profitDifference, adjustedNetProfit);
      minBaseApplied = true;
    }
    zakatBase = clamp0(zakatBase);
  }

  const zakatBeforeOwnership = Math.round((zakatBase * ratePpm) / 1_000_000);
  const zakatDue = Math.round((zakatBeforeOwnership * Math.min(100, Math.max(0, i.zakatableOwnershipPct))) / 100);
  return {
    adjustedNetProfit, profitDifference, nonCurrentLiabilitiesExcluded, nonCurrentLiabilitiesAdded, currentLiabilitiesAdded,
    totalDeductions, baseBeforeLimits, maxBase, minBaseApplied, maxBaseApplied, zakatBase, ratePpm, zakatBeforeOwnership, zakatDue,
  };
}
