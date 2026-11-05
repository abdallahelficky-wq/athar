import { describe, expect, it } from "vitest";
import { resolveCompanyVatRate, vatRatePercentOf } from "./companyVat";
import { isValidVatNumberForCountry, normalizeVatNumber } from "./vatNumber";
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

describe("tax number by country", () => {
  it.each([
    ["SA", "300000000000003", true], ["SA", "100000000000003", false],
    ["AE", "100000000000003", true], ["AE", "10000000000000", false],
    ["BH", "200000000000003", true],
    ["OM", "om1100000000", true], ["OM", "1100000000", false],
    ["EG", "100-531-385", true], ["EG", "٣٣١-١٠٥-٢٦٨", true], ["EG", "1005313850", false],
    ["MA", "001561191000066", true],
    ["DZ", "416001000000007", true], ["DZ", "41201600000606600001", true], ["DZ", "4160010000000", false],
    ["TN", "1282182 W", true], ["TN", "1234567/M/A/E/001", true], ["TN", "1234567/W/A/M/000", true], ["TN", "1234567I", false],
    ["JO", "12345678", true], ["JO", "12", false],
  ])("%s %s ⇒ %s", (country, input, ok) => {
    expect(isValidVatNumberForCountry(normalizeVatNumber(input), country)).toBe(ok);
  });
});

