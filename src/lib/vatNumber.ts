import { countryInfo } from "./countries";

/** توحيد الرقم الضريبي: بلا مسافات وشرطات ونقاط وشرطات مائلة، أرقام عربية-هندية ⇒ لاتينية، حروف كبيرة. */
export function normalizeVatNumber(input: unknown): string {
  return String(input ?? "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\s\-./]/g, "")
    .toUpperCase();
}

/** هل الرقم (بعد التوحيد) بصيغة الرقم الضريبي لتلك الدولة؟ مقابله في الواجهة: frontend/src/shared/countries.js */
export function isValidVatNumberForCountry(value: string, countryCode: string | null | undefined): boolean {
  const country = countryInfo(countryCode || "SA");
  if (!country) return false;
  return new RegExp(`^${country.vatNumberPattern}$`).test(value);
}
