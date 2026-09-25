import { badRequest } from "./httpError";

export const EXEMPTION_CODES: Record<string, readonly string[]> = {
  E: ["VATEX-SA-29", "VATEX-SA-29-7", "VATEX-SA-30"],
  Z: ["VATEX-SA-32", "VATEX-SA-33", "VATEX-SA-34-1", "VATEX-SA-34-2", "VATEX-SA-34-3", "VATEX-SA-34-4", "VATEX-SA-34-5", "VATEX-SA-35", "VATEX-SA-36", "VATEX-SA-EDU", "VATEX-SA-HEA", "VATEX-SA-MLTRY"],
};

export interface TaxFields {
  taxCategoryCode?: "S" | "Z" | "E" | "O" | null;
  taxExemptionReasonCode?: string | null;
  taxExemptionReason?: string | null;
  vatApplicable?: boolean;
}

/** Explicit categories take priority; old unclassified records retain their original S/O treatment. */
export function normalizeTax(input: TaxFields) {
  const taxCategoryCode = input.taxCategoryCode ?? (input.vatApplicable === false ? "O" : "S");
  if ((taxCategoryCode === "E" || taxCategoryCode === "Z") &&
      (!EXEMPTION_CODES[taxCategoryCode].includes(input.taxExemptionReasonCode || "") || !input.taxExemptionReason?.trim())) {
    throw badRequest("اختر سبب الإعفاء أو نسبة الصفر المناسب للصنف");
  }
  return {
    taxCategoryCode,
    vatApplicable: taxCategoryCode === "S",
    taxExemptionReasonCode: taxCategoryCode === "S" ? null : input.taxExemptionReasonCode || null,
    taxExemptionReason: taxCategoryCode === "S" ? null : input.taxExemptionReason?.trim() || null,
  };
}

/** A VAT breakdown has one subtotal per category/rate. Do not silently discard a second reason. */
export function assertCompatibleTaxReasons(lines: TaxFields[]) {
 const reasons = new Map<string, string>();
 for (const line of lines) {
  if (!line.taxCategoryCode || !line.taxExemptionReasonCode) continue;
  const previous = reasons.get(line.taxCategoryCode);
  if (previous && previous !== line.taxExemptionReasonCode) throw badRequest("استخدم مستنداً منفصلاً للأصناف ذات أسباب إعفاء أو نسبة صفر مختلفة ضمن الفئة نفسها");
  reasons.set(line.taxCategoryCode, line.taxExemptionReasonCode);
 }
}
