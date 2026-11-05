import { countryInfo } from "./countries";

/**
 * توحيد رقم جوال لدولة مدعومة إلى الصيغة الدولية بلا "+" (مفتاح الدولة + الرقم الوطني)، وهي الصيغة التي
 * تتطلبها WhatsApp Cloud API في حقل "to". يقبل الصيغة المحلية (01012345678)، أو بلا الصفر، أو بمفتاح الدولة
 * (+20… أو 0020… أو 20…)، مع مسافات/شرطات/أقواس وأرقام عربية-هندية (٠-٩). قواعد كل دولة في
 * src/lib/countries.ts (dialCode/mobilePattern). يعيد null لأي رقم ليس جوالاً صالحاً لتلك الدولة.
 * مقابله في الواجهة: normalizeMobile في frontend/src/lib/whatsapp.js (للتحقق الفوري فقط).
 */
export function normalizeMobile(input: unknown, countryCode = "SA"): string | null {
  const country = countryInfo(countryCode);
  if (!country) return null;
  let d = String(input ?? "")
    .replace(/[\s\-().]/g, "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  const international = d.startsWith("+") || d.startsWith("00");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  const pattern = new RegExp(`^${country.mobilePattern}$`);
  if (international) {
    // رقم دولي صريح: يجب أن يحمل مفتاح الدولة المختارة نفسها
    if (!d.startsWith(country.dialCode)) return null;
    d = d.slice(country.dialCode.length);
  } else if (d.startsWith(country.dialCode) && !pattern.test(d.replace(/^0/, ""))) {
    d = d.slice(country.dialCode.length);
  }
  if (d.startsWith("0")) d = d.slice(1);
  return pattern.test(d) ? `${country.dialCode}${d}` : null;
}

/** جوال سعودي (9665XXXXXXXX) — للمسارات الخاصة بالسعودية (بوابة الموظف…). */
export function normalizeSaudiMobile(input: unknown): string | null {
  return normalizeMobile(input, "SA");
}

/** إخفاء الرقم في السجلّات: 9665XXXX1234 → 9665*****234. */
export function maskPhone(phone: string): string {
  return phone.length <= 7 ? "***" : `${phone.slice(0, 4)}${"*".repeat(phone.length - 7)}${phone.slice(-3)}`;
}
