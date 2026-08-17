import { describe, it, expect } from "vitest";
import { accumulatedDepreciation, monthlyDepreciation } from "./depreciation";

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
