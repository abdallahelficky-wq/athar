import { describe, expect, it } from "vitest";
import { computeCheckout } from "./storeCheckout";

// صنفان خاضعان 15%: 115 + 230 = 345 شامل، 300 قبل الضريبة
const lines = [{ lineTotal: 115, lineExVat: 100 }, { lineTotal: 230, lineExVat: 200 }];
const base = { lines, coupon: null, shippingFee: 0, freeShippingOver: null, vatRatePercent: 15 };

describe("computeCheckout", () => {
  it("totals the items with their own VAT when there is no coupon or shipping", () => {
    expect(computeCheckout(base)).toEqual({ itemsTotal: 345, discount: 0, couponApplied: false, shippingFee: 0, freeShipping: false, subtotal: 300, vat: 45, total: 345 });
  });
  it("adds a VAT-inclusive shipping fee and its VAT", () => {
    expect(computeCheckout({ ...base, shippingFee: 23 })).toMatchObject({ shippingFee: 23, total: 368, vat: 48, subtotal: 320 });
  });
  it("takes a percent coupon off the items only and scales the items VAT with it", () => {
    const r = computeCheckout({ ...base, shippingFee: 23, coupon: { code: "TEN", type: "percent", value: 10, minOrderAmount: null } });
    expect(r).toMatchObject({ discount: 34.5, couponApplied: true, shippingFee: 23, total: 333.5, vat: 43.5, subtotal: 290 });
  });
  it("caps a fixed coupon at the items total and never discounts shipping", () => {
    const r = computeCheckout({ ...base, shippingFee: 23, coupon: { code: "BIG", type: "fixed", value: 1000, minOrderAmount: null } });
    expect(r).toMatchObject({ discount: 345, total: 23, vat: 3, subtotal: 20 });
  });
  it("ignores a coupon below its minimum order", () => {
    const r = computeCheckout({ ...base, coupon: { code: "MIN", type: "fixed", value: 50, minOrderAmount: 500 } });
    expect(r).toMatchObject({ discount: 0, couponApplied: false, total: 345 });
  });
  it("waives shipping once the items after discount reach the free-shipping amount", () => {
    expect(computeCheckout({ ...base, shippingFee: 23, freeShippingOver: 345 })).toMatchObject({ shippingFee: 0, freeShipping: true, total: 345 });
    // الخصم ينزل بالمجموع تحت الحد فيعود الشحن
    expect(computeCheckout({ ...base, shippingFee: 23, freeShippingOver: 345, coupon: { code: "X", type: "fixed", value: 10, minOrderAmount: null } })).toMatchObject({ shippingFee: 23, freeShipping: false, total: 358 });
  });
  it("charges no VAT on items that carry none", () => {
    expect(computeCheckout({ ...base, lines: [{ lineTotal: 50, lineExVat: 50 }] })).toMatchObject({ vat: 0, subtotal: 50, total: 50 });
  });
});
