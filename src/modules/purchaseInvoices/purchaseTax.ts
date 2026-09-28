import { TaxFields } from "../../lib/itemTax";

// Purchase VAT is entered from the supplier invoice; sales exemption reasons do not apply.
export function normalizePurchaseTax(input: TaxFields) {
  const taxCategoryCode = input.taxCategoryCode ?? (input.vatApplicable === false ? "O" : "S");
  return { taxCategoryCode, vatApplicable: taxCategoryCode === "S",
    taxExemptionReasonCode: null, taxExemptionReason: null };
}
