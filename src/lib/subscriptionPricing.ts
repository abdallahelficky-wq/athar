import type { BillingPeriod, SubscriptionPlan } from "@prisma/client";
import { fromHalalas, mulDivHalfUp, toHalalas, vatOnNetHalalas } from "./money";
import { riyadhCalendarDay } from "./riyadhDate";

/**
 * معادلات تسعير الاشتراك (docs/design/subscription-plans.md §4 و§4.1) — دوال صافية بلا قاعدة بيانات، بالهللات عبر money.ts،
 * تقريب نصف للأعلى إلى 0.01. الأسعار السنوية نفسها تأتي من plan_prices (انظر subscriptionPreview.service.ts)، لا من هنا.
 */

export const SUBSCRIPTION_VAT_PERCENT = 15;
/**
 * القسط الشهري = السنوي ÷ 12 × 1.20 (D34): الأساسية 50، الاحترافية 100، المؤسسية 150 شهرياً — والسنوي "ادفع 10 أشهر واحصل على 12".
 * الواجهة (صفحة الهبوط) تعرض السعر الشهري من frontend/src/lib/subscriptionPlans.js، واختبار يفرض تطابق المعاملين.
 */
export const MONTHLY_NUMERATOR = 120;
export const MONTHLY_DENOMINATOR = 1200;
/** سقف الخصم 50% من الشركة الخامسة (D16) */
export const MAX_DISCOUNT_PCT = 50;

/** الأولى بالسعر الكامل، ثم 20، 30، 40، 50، 50… (D3، D16) */
export function discountPct(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) throw new Error(`ترتيب غير صالح: ${rank}`);
  return rank === 1 ? 0 : Math.min(10 * rank, MAX_DISCOUNT_PCT);
}

/**
 * سعر الباقة للفترة بعد الخصم، بالهللات: round2(base × (100 − pct) / 100)، والأساس الشهري غير مقرَّب قبل الخصم
 * (مثال الترتيب 2 الشهري: 50 × 0.8 = 40.00) — تقريب واحد للسطر.
 */
export function periodNetHalalas(yearlyNetHalalas: number, period: BillingPeriod, pct: number): number {
  const keep = 100 - pct;
  return period === "yearly"
    ? mulDivHalfUp(yearlyNetHalalas, keep, 100)
    : mulDivHalfUp(yearlyNetHalalas, MONTHLY_NUMERATOR * keep, MONTHLY_DENOMINATOR * 100);
}

/** سطر إضافة بلا خصم (D17): الكمية × السعر السنوي، أو بالمعادلة الشهرية — تقريب واحد للسطر */
export function addonNetHalalas(yearlyUnitHalalas: number, quantity: number, period: BillingPeriod): number {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`كمية غير صالحة: ${quantity}`);
  const total = yearlyUnitHalalas * quantity;
  return period === "yearly" ? total : mulDivHalfUp(total, MONTHLY_NUMERATOR, MONTHLY_DENOMINATOR);
}

export type QuoteLineKind = "plan" | "extra_users" | "pos_included" | "pos_extra_users" | "stations" | "stables";

export type QuoteLine = {
  kind: QuoteLineKind;
  quantity: number;
  discountPct: number;
  net: number;
  vat: number;
  /** سطر بلا مقابل: مستخدم نقطة البيع المشمول (D27) أو إضافة نشاط بلا سعر بعد (D30) */
  free: boolean;
};

export type Quote = { lines: QuoteLine[]; net: number; vat: number; total: number };

export function quoteLine(kind: QuoteLineKind, quantity: number, pct: number, netHalalas: number, free = false): QuoteLine & { netHalalas: number; vatHalalas: number } {
  const vatHalalas = vatOnNetHalalas(netHalalas, SUBSCRIPTION_VAT_PERCENT);
  return { kind, quantity, discountPct: pct, net: fromHalalas(netHalalas), vat: fromHalalas(vatHalalas), free, netHalalas, vatHalalas };
}

/** الإجماليات = مجموع الأسطر بالهللات (الضريبة لكل سطر كأي فاتورة في أثر) */
export function buildQuote(lines: (QuoteLine & { netHalalas: number; vatHalalas: number })[]): Quote {
  const net = lines.reduce((s, l) => s + l.netHalalas, 0);
  const vat = lines.reduce((s, l) => s + l.vatHalalas, 0);
  return {
    lines: lines.map(({ netHalalas: _n, vatHalalas: _v, ...l }) => l),
    net: fromHalalas(net),
    vat: fromHalalas(vat),
    total: fromHalalas(net + vat),
  };
}

/** السعر المقفل للفترة الحالية: السعر المحفوظ تاريخياً (D10) إن وُجد، وإلا netPrice */
export function lockedNet(sub: { netPrice: number; grandfatheredNetPrice: number | null }): number {
  return sub.grandfatheredNetPrice ?? sub.netPrice;
}

const DAY_MS = 86_400_000;
function ksaDayNumber(instant: Date): number {
  return Date.parse(`${riyadhCalendarDay(instant)}T00:00:00.000Z`) / DAY_MS;
}

/**
 * فرق الترقية المتناسب (§4.1، D22): round2((السعر الجديد − المقفل) × الأيام المتبقية / أيام الفترة)، بأيام تقويمية سعودية.
 * الترقية وحدها تُحسَب هنا — التخفيض يُجدوَل للتجديد بلا استرداد، فيُرفَض. يصلح أيضاً لرفع كميات الإضافات (بلا خصم).
 */
export function upgradeProrationNet(input: {
  newPeriodNet: number;
  lockedNet: number;
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
}): { net: number; remainingDays: number; termDays: number } {
  const start = ksaDayNumber(input.periodStart);
  const end = ksaDayNumber(input.periodEnd);
  const change = ksaDayNumber(input.changeAt);
  if (end <= start) throw new Error("فترة اشتراك غير صالحة");
  if (change < start || change >= end) throw new Error("تاريخ التغيير خارج الفترة الحالية");
  const difference = toHalalas(input.newPeriodNet) - toHalalas(input.lockedNet);
  if (difference <= 0) throw new Error("ليست ترقية: التخفيض يُطبَّق عند التجديد التالي");
  const remainingDays = end - change;
  const termDays = end - start;
  return { net: fromHalalas(mulDivHalfUp(difference, remainingDays, termDays)), remainingDays, termDays };
}

export type PlanPriceTable = Record<"plan_basic" | "plan_professional" | "plan_enterprise" | "addon_user" | "addon_pos_extra_user" | "addon_stations" | "addon_stables", number | null>;

export type AddOnSelection = {
  extraUsers?: number;
  posEnabled?: boolean;
  /** المقاعد الإضافية المدفوعة فوق المستخدم المجاني */
  additionalPosUsers?: number;
  stations?: boolean;
  stables?: boolean;
};

/** عرض سعر شركة واحدة بترتيب معلوم — منطق previewSubscriptionPrice بلا قاعدة بيانات */
export function quoteCompany(prices: PlanPriceTable, plan: SubscriptionPlan, period: BillingPeriod, rank: number, addOns: AddOnSelection = {}): Quote & { rank: number } {
  const planPrice = prices[`plan_${plan}`];
  if (planPrice == null) throw new Error(`لا سعر سارياً للباقة ${plan}`);
  const pct = discountPct(rank);
  const lines = [quoteLine("plan", 1, pct, periodNetHalalas(toHalalas(planPrice), period, pct))];

  const priced = (item: keyof PlanPriceTable) => {
    const v = prices[item];
    if (v == null) throw new Error(`لا سعر سارياً للبند ${item}`);
    return toHalalas(v);
  };
  if (addOns.extraUsers) lines.push(quoteLine("extra_users", addOns.extraUsers, 0, addonNetHalalas(priced("addon_user"), addOns.extraUsers, period)));
  if (addOns.additionalPosUsers && !addOns.posEnabled) throw new Error("مقاعد نقطة البيع الإضافية تتطلب تفعيل نقطة البيع");
  if (addOns.posEnabled) {
    lines.push(quoteLine("pos_included", 1, 0, 0, true));
    if (addOns.additionalPosUsers) {
      lines.push(quoteLine("pos_extra_users", addOns.additionalPosUsers, 0, addonNetHalalas(priced("addon_pos_extra_user"), addOns.additionalPosUsers, period)));
    }
  }
  for (const kind of ["stations", "stables"] as const) {
    if (!addOns[kind]) continue;
    const unit = prices[`addon_${kind}`];
    // D30: بلا سعر بعد = مجانية؛ يظهر السطر بصفر حتى يعرف المشترك أنها مشمولة
    lines.push(unit == null ? quoteLine(kind, 1, 0, 0, true) : quoteLine(kind, 1, 0, addonNetHalalas(toHalalas(unit), 1, period)));
  }
  return { ...buildQuote(lines), rank };
}
