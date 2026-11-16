import { describe, expect, it } from "vitest";
import { storePrice, isTaxable } from "./storePricing";

describe("storePrice", () => {
  it("keeps a VAT-inclusive sale price and splits the VAT out of it", () => {
    expect(storePrice({ salePrice: 115, priceIncludesVat: true, taxCategoryCode: "S", vatApplicable: true }, 15)).toEqual({ price: 115, priceExVat: 100, vat: 15, vatRatePercent: 15 });
  });
  it("adds VAT on top of a VAT-exclusive sale price", () => {
    expect(storePrice({ salePrice: 35, priceIncludesVat: false, taxCategoryCode: "S", vatApplicable: true }, 15)).toEqual({ price: 40.25, priceExVat: 35, vat: 5.25, vatRatePercent: 15 });
  });
  it("charges no VAT on a zero-rated, exempt or out-of-scope item, whatever the price basis", () => {
    for (const code of ["Z", "E", "O"]) {
      for (const priceIncludesVat of [true, false]) {
        expect(storePrice({ salePrice: 50, priceIncludesVat, taxCategoryCode: code, vatApplicable: false }, 15)).toEqual({ price: 50, priceExVat: 50, vat: 0, vatRatePercent: 0 });
      }
    }
  });
  it("treats an unclassified legacy item by vatApplicable", () => {
    expect(isTaxable({ taxCategoryCode: null, vatApplicable: true })).toBe(true);
    expect(isTaxable({ taxCategoryCode: null, vatApplicable: false })).toBe(false);
  });
  it("uses the company's own rate", () => {
    expect(storePrice({ salePrice: 100, priceIncludesVat: false, taxCategoryCode: "S", vatApplicable: true }, 5).price).toBe(105);
  });
});
