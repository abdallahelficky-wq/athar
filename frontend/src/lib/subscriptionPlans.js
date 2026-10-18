/**
 * معامل السعر الشهري: الشهري = السنوي × 120 ÷ 1200 (أي ÷ 12 × 1.20، D34) — نفس MONTHLY_NUMERATOR/MONTHLY_DENOMINATOR في
 * src/lib/subscriptionPricing.ts (معادلة الفوترة)، واختبار الخادم subscriptionPricing.frontendParity.test.ts يفرض تطابقهما وتطابق الأسعار
 * المعروضة. لا يُكتب المعامل في أي مكان آخر في الواجهة.
 */
export const MONTHLY_PRICE_FACTOR = Object.freeze({ numerator: 120, denominator: 1200 });

/** السعر الشهري الصافي من السعر السنوي — بالهللات وتقريب نصف للأعلى إلى 0.01، كمعادلة الفوترة (سطر بلا خصم) */
export function monthlyPriceFromYearly(yearlyNet) {
  const halalas = Math.round(yearlyNet * 100);
  return Math.round((halalas * MONTHLY_PRICE_FACTOR.numerator) / MONTHLY_PRICE_FACTOR.denominator) / 100;
}

export const SUBSCRIPTION_PLANS = [{ id: "basic", annualPrice: 500 }, { id: "professional", annualPrice: 1000 }, { id: "enterprise", annualPrice: 1500 }];
