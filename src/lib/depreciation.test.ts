import { describe, it, expect } from "vitest";
import { accumulatedDepreciation, accumulatedDepreciationExisting, existingAssetChargeForMonth, monthlyDepreciation } from "./depreciation";

describe("monthlyDepreciation", () => {
  it("computes straight-line monthly depreciation", () => {
    // (12000 - 0) / 5 years / 12 months = 200/month
    expect(monthlyDepreciation({ cost: 12000, salvageValue: 0, usefulLifeYears: 5 })).toBeCloseTo(200);
  });

  it("subtracts salvage value from the depreciable base", () => {
    // (12000 - 2000) / 5 / 12 = 166.666...
    expect(monthlyDepreciation({ cost: 12000, salvageValue: 2000, usefulLifeYears: 5 })).toBeCloseTo(166.6667, 3);
  });

  it("returns 0 when usefulLifeYears is 0 or missing", () => {
    expect(monthlyDepreciation({ cost: 12000, salvageValue: 0, usefulLifeYears: 0 })).toBe(0);
  });

  it("returns 0 for a non-depreciable asset regardless of other inputs", () => {
    expect(monthlyDepreciation({ cost: 12000, salvageValue: 0, usefulLifeYears: 5, isDepreciable: false })).toBe(0);
  });

  it("computes normally when isDepreciable is explicitly true", () => {
    expect(monthlyDepreciation({ cost: 12000, salvageValue: 0, usefulLifeYears: 5, isDepreciable: true })).toBeCloseTo(200);
  });
});

describe("accumulatedDepreciation", () => {
  it("accrues monthly depreciation up to the given date", () => {
    const asset = { cost: 12000, salvageValue: 0, usefulLifeYears: 5, purchaseDate: new Date(2026, 0, 1) };
    // 6 months elapsed by 2026-07-01 * 200/month = 1200
    expect(accumulatedDepreciation(asset, new Date(2026, 6, 1))).toBeCloseTo(1200);
  });

  it("caps accumulated depreciation at cost minus salvage value (never exceeds it)", () => {
    const asset = { cost: 12000, salvageValue: 0, usefulLifeYears: 1, purchaseDate: new Date(2020, 0, 1) };
    // far beyond the useful life — should cap at 12000, not keep accruing
    expect(accumulatedDepreciation(asset, new Date(2026, 0, 1))).toBe(12000);
  });

  it("returns 0 for dates before the purchase date (no negative depreciation)", () => {
    const asset = { cost: 12000, salvageValue: 0, usefulLifeYears: 5, purchaseDate: new Date(2026, 6, 1) };
    expect(accumulatedDepreciation(asset, new Date(2026, 0, 1))).toBe(0);
  });

  it("returns 0 for a non-depreciable asset even with months elapsed", () => {
    const asset = { cost: 12000, salvageValue: 0, usefulLifeYears: 5, purchaseDate: new Date(2020, 0, 1), isDepreciable: false };
    expect(accumulatedDepreciation(asset, new Date(2026, 0, 1))).toBe(0);
  });
});

// أصل قائم: آلة بتكلفة 120,000 وعمر 10 سنوات (قسط 1,000 شهرياً)، مجمع مُرحَّل 30,000 حتى 31/12/2025.
const existing = {
  cost: 120000, salvageValue: 0, usefulLifeYears: 10,
  openingAccumulatedDepreciation: 30000, openingDepreciationAsOf: new Date(2025, 11, 31),
};

describe("accumulatedDepreciationExisting", () => {
  it("equals the opening accumulated depreciation on the as-of month itself (nothing re-charged)", () => {
    expect(accumulatedDepreciationExisting(existing, new Date(2025, 11, 31))).toBe(30000);
  });

  it("adds one monthly charge per month after the as-of month", () => {
    // يناير…أكتوبر 2026 = 10 أشهر بعد ديسمبر 2025 → 30,000 + 10,000
    expect(accumulatedDepreciationExisting(existing, new Date(2026, 9, 31))).toBeCloseTo(40000);
  });

  it("caps at cost minus salvage value", () => {
    expect(accumulatedDepreciationExisting(existing, new Date(2060, 0, 1))).toBe(120000);
    expect(accumulatedDepreciationExisting({ ...existing, salvageValue: 20000 }, new Date(2060, 0, 1))).toBe(100000);
  });

  it("clamps an opening balance that exceeds the depreciable base", () => {
    expect(accumulatedDepreciationExisting({ ...existing, openingAccumulatedDepreciation: 999999 }, new Date(2026, 0, 1))).toBe(120000);
  });

  it("keeps only the opening balance for a non-depreciable asset", () => {
    expect(accumulatedDepreciationExisting({ ...existing, isDepreciable: false }, new Date(2030, 0, 1))).toBe(30000);
  });
});

describe("existingAssetChargeForMonth", () => {
  it("charges nothing for months up to and including the as-of month (already booked in the ledger)", () => {
    expect(existingAssetChargeForMonth(existing, "2025-12")).toBe(0);
    expect(existingAssetChargeForMonth(existing, "2025-06")).toBe(0);
  });

  it("charges one full monthly instalment from the month after the as-of month", () => {
    expect(existingAssetChargeForMonth(existing, "2026-01")).toBeCloseTo(1000);
    expect(existingAssetChargeForMonth(existing, "2026-10")).toBeCloseTo(1000);
  });

  it("charges only the remaining depreciable base in the final month, then nothing", () => {
    // مجمع 119,400 → يتبقى 600 فقط
    const nearlyDone = { ...existing, openingAccumulatedDepreciation: 119400 };
    expect(existingAssetChargeForMonth(nearlyDone, "2026-01")).toBeCloseTo(600);
    expect(existingAssetChargeForMonth(nearlyDone, "2026-02")).toBe(0);
  });

  it("charges nothing for a non-depreciable asset", () => {
    expect(existingAssetChargeForMonth({ ...existing, isDepreciable: false }, "2026-01")).toBe(0);
  });

  it("the sum of monthly charges plus the opening balance matches accumulatedDepreciationExisting", () => {
    let total = existing.openingAccumulatedDepreciation;
    for (let m = 1; m <= 10; m++) total += existingAssetChargeForMonth(existing, `2026-${String(m).padStart(2, "0")}`);
    expect(total).toBeCloseTo(accumulatedDepreciationExisting(existing, new Date(2026, 9, 31)));
  });
});
