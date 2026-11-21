import { describe, expect, it } from "vitest";
import { computeZakat, zakatRatePpm, type ZakatInputs } from "./zakatEngine";

// المبالغ بالهللات في المحرّك؛ هنا بالريال × 100
const R = (n: number) => n * 100;
const base: ZakatInputs = {
  method: "regulation_1445",
  equity: R(1_000_000), nonCurrentLiabilities: R(200_000), currentLiabilities: R(300_000),
  deductibleNonCurrentAssets: R(600_000), nonDeductibleNonCurrentAssets: 0,
  deductibleCurrentAssets: 0, nonDeductibleCurrentAssets: R(900_000),
  bookNetProfit: R(150_000), profitAdjustments: R(20_000),
  periodDays: 354, hijriYear: true, zakatableOwnershipPct: 100,
};

describe("zakat rate", () => {
  it("2.5% for a Hijri year, prorated by days over 354 otherwise", () => {
    expect(zakatRatePpm(354, true)).toBe(25_000);
    expect(zakatRatePpm(365, false)).toBe(25_777); // 2.5777%
    expect(zakatRatePpm(366, false)).toBe(25_847);
  });
});

describe("regulation 1445 base", () => {
  it("equity + profit difference + non-current liabilities − deductible non-current assets", () => {
    const r = computeZakat(base);
    // 1,000,000 + 20,000 + 200,000 − 600,000 = 620,000 (≤ الحد الأعلى 1,020,000، ≥ الربح المعدل 170,000)
    expect(r.zakatBase).toBe(R(620_000));
    expect(r.adjustedNetProfit).toBe(R(170_000));
    expect(r.maxBase).toBe(R(1_020_000));
    expect(r.zakatDue).toBe(R(15_500)); // 2.5%
  });
  it("excludes non-current liabilities in proportion to non-deducted non-current assets", () => {
    // نصف الأصول غير المتداولة غير محسومة ⇒ يُستبعد نصف الالتزامات غير المتداولة (100,000)
    const r = computeZakat({ ...base, deductibleNonCurrentAssets: R(300_000), nonDeductibleNonCurrentAssets: R(300_000) });
    expect(r.nonCurrentLiabilitiesExcluded).toBe(R(100_000));
    expect(r.zakatBase).toBe(R(1_000_000 + 20_000 + 100_000 - 300_000));
  });
  it("adds current liabilities in proportion to deducted current assets, capped by that asset", () => {
    // متداول محسوم 90,000 من 900,000 ⇒ 10% من الالتزامات المتداولة = 30,000
    const r = computeZakat({ ...base, deductibleCurrentAssets: R(90_000), nonDeductibleCurrentAssets: R(810_000) });
    expect(r.currentLiabilitiesAdded).toBe(R(30_000));
    expect(r.totalDeductions).toBe(R(690_000));
  });
  it("caps added liabilities at total deductions", () => {
    const r = computeZakat({ ...base, nonCurrentLiabilities: R(900_000), deductibleNonCurrentAssets: R(100_000), nonDeductibleNonCurrentAssets: 0 });
    expect(r.nonCurrentLiabilitiesAdded + r.currentLiabilitiesAdded).toBe(R(100_000));
  });
  it("never exceeds the maximum base (equity + profit difference) — added liabilities are capped by deductions", () => {
    for (const ncl of [0, 500_000, 2_000_000, 9_000_000]) {
      const r = computeZakat({ ...base, nonCurrentLiabilities: R(ncl), deductibleNonCurrentAssets: R(2_000_000), equity: R(100_000), bookNetProfit: 0, profitAdjustments: 0 });
      expect(r.zakatBase).toBeLessThanOrEqual(r.maxBase);
    }
  });
  it("applies the minimum base when the base falls below adjusted net profit", () => {
    // وعاء سالب مع ربح معدل 170,000 وأصول غير محسومة 900,000 ⇒ الأقل من (900,000+20,000) و170,000 = 170,000
    const r = computeZakat({ ...base, equity: R(100_000), deductibleNonCurrentAssets: R(1_500_000), nonCurrentLiabilities: 0 });
    expect(r.minBaseApplied).toBe(true);
    expect(r.zakatBase).toBe(R(170_000));
  });
  it("a negative base with no adjusted profit is zero", () => {
    const r = computeZakat({ ...base, equity: R(100_000), deductibleNonCurrentAssets: R(1_500_000), nonCurrentLiabilities: 0, bookNetProfit: R(-50_000), profitAdjustments: 0 });
    expect(r.zakatBase).toBe(0);
    expect(r.zakatDue).toBe(0);
  });
  it("applies the zakatable ownership share and the Gregorian rate", () => {
    const r = computeZakat({ ...base, periodDays: 365, hijriYear: false, zakatableOwnershipPct: 60 });
    expect(r.zakatBeforeOwnership).toBe(Math.round((R(620_000) * 25_777) / 1_000_000));
    expect(r.zakatDue).toBe(Math.round((r.zakatBeforeOwnership * 60) / 100));
  });
});

describe("net current assets method", () => {
  it("current assets − current liabilities + profit difference, not below zero", () => {
    const r = computeZakat({ ...base, method: "net_current_assets" });
    expect(r.zakatBase).toBe(R(900_000 - 300_000 + 20_000));
    expect(computeZakat({ ...base, method: "net_current_assets", currentLiabilities: R(2_000_000) }).zakatBase).toBe(0);
  });
});
