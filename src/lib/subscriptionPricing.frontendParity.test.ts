import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MONTHLY_DENOMINATOR, MONTHLY_NUMERATOR, addonNetHalalas, periodNetHalalas } from "./subscriptionPricing";
import { fromHalalas, toHalalas } from "./money";

/**
 * صفحة الهبوط تعرض السعر الشهري، والفوترة تحسبه — مصدران كانا يكتبان المعامل كلٌّ بنفسه (الصفحة "* 1.10" يدوياً). هنا يُفرض أن
 * معامل الواجهة (frontend/src/lib/subscriptionPlans.js) هو معامل الفوترة نفسه، وأن كل سعر شهري تعرضه الصفحة هو ما تفوتره الخدمة
 * لسطر بلا خصم، وأن الصفحة لا تكتب معاملاً خاصاً بها (D34).
 */
const frontendModule = () => import(path.resolve("frontend/src/lib/subscriptionPlans.js") as string);

describe("landing-page monthly price = billing formula", () => {
  it("uses the same monthly factor as the billing formula", async () => {
    const { MONTHLY_PRICE_FACTOR } = await frontendModule();
    expect(MONTHLY_PRICE_FACTOR).toEqual({ numerator: MONTHLY_NUMERATOR, denominator: MONTHLY_DENOMINATOR });
  });

  it("shows exactly what billing charges for every plan and priced add-on: 50 / 100 / 150, 12 and 60", async () => {
    const { SUBSCRIPTION_PLANS, monthlyPriceFromYearly } = await frontendModule();
    const shown = (SUBSCRIPTION_PLANS as { id: string; annualPrice: number }[]).map((p) => monthlyPriceFromYearly(p.annualPrice));
    expect(shown).toEqual([50, 100, 150]);
    for (const p of SUBSCRIPTION_PLANS as { annualPrice: number }[]) {
      expect(monthlyPriceFromYearly(p.annualPrice)).toBe(fromHalalas(periodNetHalalas(toHalalas(p.annualPrice), "monthly", 0)));
    }
    // الإضافات (بلا خصم) وسعر بكسور يختبر التقريب نفسه (نصف للأعلى بالهللات)
    for (const yearly of [120, 600, 999.99, 1234.57]) {
      expect(monthlyPriceFromYearly(yearly), String(yearly)).toBe(fromHalalas(addonNetHalalas(toHalalas(yearly), 1, "monthly")));
    }
    expect([monthlyPriceFromYearly(120), monthlyPriceFromYearly(600)]).toEqual([12, 60]);
  });

  it("the landing page derives the monthly price from the shared function, with no factor of its own", () => {
    const page = readFileSync(path.resolve("frontend/src/pages/LandingPage.jsx"), "utf8");
    expect(page).toContain("monthlyPriceFromYearly(SUBSCRIPTION_PLANS[i].annualPrice)");
    expect(page).not.toMatch(/\/\s*12\s*\)?\s*\*\s*1\.\d/);
    expect(page).not.toMatch(/\*\s*1\.(1|10|2|20)\b/);
  });
});
