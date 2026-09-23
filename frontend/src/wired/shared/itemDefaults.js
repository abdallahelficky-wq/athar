export const taxCategory = (item) => item.taxCategoryCode || (item.vatApplicable === false ? "O" : "S");
export const itemDescription = (item) => [item.name, item.nameEn].filter(Boolean).join(" / ");
export function itemTaxDefaults(item) {
  const taxCategoryCode = taxCategory(item);
  return { priceIncludesVat: item.priceIncludesVat !== false, taxCategoryCode,
    vatApplicable: taxCategoryCode === "S", taxExemptionReasonCode: item.taxExemptionReasonCode || null,
    taxExemptionReason: item.taxExemptionReason || null };
}
export const itemMatches = (item, query) => [itemDescription(item), item.name, item.nameEn, item.code, item.barcode].some((v) => String(v || "").toLocaleLowerCase().includes(query.toLocaleLowerCase()));
export const exemptionCodes = {
 E: ["VATEX-SA-29", "VATEX-SA-29-7", "VATEX-SA-30"],
 Z: ["VATEX-SA-32", "VATEX-SA-33", "VATEX-SA-34-1", "VATEX-SA-34-2", "VATEX-SA-34-3", "VATEX-SA-34-4", "VATEX-SA-34-5", "VATEX-SA-35", "VATEX-SA-36", "VATEX-SA-EDU", "VATEX-SA-HEA", "VATEX-SA-MLTRY"],
};
