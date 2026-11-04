/**
 * توحيد رقم جوال سعودي إلى الصيغة الدولية بلا "+" (9665XXXXXXXX) — الصيغة التي تتطلبها WhatsApp Cloud
 * API في حقل "to". يقبل: 05XXXXXXXX، 5XXXXXXXX، +9665XXXXXXXX، 009665XXXXXXXX، 9665XXXXXXXX، مع
 * مسافات/شرطات/أقواس وأرقام عربية-هندية (٠-٩). يعيد null لأي رقم ليس جوالاً سعودياً صالحاً.
 * مقابله في الواجهة: normalizeSaudiMobile في frontend/src/lib/whatsapp.js (للتحقق الفوري فقط).
 */
export function normalizeSaudiMobile(input: unknown): string | null {
  let d = String(input ?? "")
    .replace(/[\s\-().]/g, "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? `966${d}` : null;
}

/** إخفاء الرقم في السجلّات: 9665XXXX1234 → 9665*****234. */
export function maskPhone(phone: string): string {
  return phone.length <= 7 ? "***" : `${phone.slice(0, 4)}${"*".repeat(phone.length - 7)}${phone.slice(-3)}`;
}
