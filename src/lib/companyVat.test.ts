import { describe, expect, it } from "vitest";
import { resolveCompanyVatRate, vatRatePercentOf } from "./companyVat";
import { computeInvoiceLine } from "./invoiceLine";
import { COUNTRIES } from "./countries";

describe("company VAT rate", () => {
  it("Saudi Arabia is always 15%", () => {
    expect(vatRatePercentOf({ country: "SA", vatRate: 5 })).toBe(15);
    expect(resolveCompanyVatRate("SA", 5)).toBe(15);
    expect(vatRatePercentOf(null)).toBe(15);
  });
  it("other countries use the stored rate, or the country's default", () => {
    expect(vatRatePercentOf({ country: "EG", vatRate: "14.00" })).toBe(14);
    expect(vatRatePercentOf({ country: "KW", vatRate: 0 })).toBe(0);
    expect(resolveCompanyVatRate("EG", undefined)).toBe(14);
    expect(resolveCompanyVatRate("EG", 10)).toBe(10);
    expect(resolveCompanyVatRate("QA", undefined)).toBe(0);
  });
  it("every supported country has a default rate between 0 and 100", () => {
    for (const c of COUNTRIES) expect(c.defaultVatRate, c.code).toBeGreaterThanOrEqual(0);
  });
  it("computes invoice lines at the company rate", () => {
    expect(computeInvoiceLine({ quantity: 1, unitPrice: 100, vatRatePercent: 14 })).toEqual({ subtotal: 100, vat: 14, total: 114 });
    expect(computeInvoiceLine({ quantity: 1, unitPrice: 114, priceIncludesVat: true, vatRatePercent: 14 })).toEqual({ subtotal: 100, vat: 14, total: 114 });
    expect(computeInvoiceLine({ quantity: 1, unitPrice: 100, vatRatePercent: 0 })).toEqual({ subtotal: 100, vat: 0, total: 100 });
    expect(computeInvoiceLine({ quantity: 1, unitPrice: 100 })).toEqual({ subtotal: 100, vat: 15, total: 115 });
  });
});
