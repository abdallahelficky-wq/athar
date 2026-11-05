import { COUNTRIES } from "../shared/countries";
/**
 * قناة واتساب الرسمية لأثر (تواصل، مبيعات، دعم فني) — مصدر واحد للرقم ولبناء روابط wa.me في كل الواجهة،
 * حتى لا يتكرر الرقم في المكوّنات. يمكن تغييره عند البناء عبر VITE_SUPPORT_WHATSAPP_NUMBER (أرقام دولية
 * بلا + ولا أصفار بادئة، مثل 966573076236)، والقيمة الافتراضية هي الرقم المعتمد حالياً.
 */
const DEFAULT_NUMBER = "966573076236";

const raw = String(import.meta.env?.VITE_SUPPORT_WHATSAPP_NUMBER || DEFAULT_NUMBER).replace(/\D/g, "");

export const SUPPORT_WHATSAPP_NUMBER = raw || DEFAULT_NUMBER;

/** الرقم بصيغته المحلية للعرض (0573076236) لرقم سعودي، وإلا بصيغة دولية بعلامة +. */
export const SUPPORT_WHATSAPP_DISPLAY = SUPPORT_WHATSAPP_NUMBER.startsWith("966")
  ? "0" + SUPPORT_WHATSAPP_NUMBER.slice(3)
  : "+" + SUPPORT_WHATSAPP_NUMBER;

/** رابط محادثة واتساب برسالة جاهزة اختيارية (تُرمَّز تلقائياً). */
export function buildWhatsAppLink(message) {
  const base = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`;
  const text = typeof message === "string" ? message.trim() : "";
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * توحيد رقم جوال سعودي إلى الصيغة الدولية 9665XXXXXXXX — نفس منطق normalizeSaudiMobile في الخادم
 * (src/lib/phone.ts)، للتحقق الفوري في النموذج فقط؛ الخادم هو الحَكَم. يعيد null لرقم غير صالح.
 */
export function normalizeSaudiMobile(input) {
  let d = String(input ?? "").replace(/[\s\-().]/g, "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? "966" + d : null;
}

/**
 * توحيد رقم جوال لدولة مدعومة إلى مفتاح الدولة + الرقم الوطني (مثل 201018889364) — نفس منطق normalizeMobile
 * في الخادم (src/lib/phone.ts)، للتحقق الفوري في النموذج فقط؛ الخادم هو الحَكَم. يعيد null لرقم غير صالح.
 */
export function normalizeMobile(input, countryCode = "SA") {
  const country = COUNTRIES.find((c) => c.code === countryCode);
  if (!country) return null;
  let d = String(input ?? "").replace(/[\s\-().]/g, "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  const international = d.startsWith("+") || d.startsWith("00");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  const pattern = new RegExp(`^${country.mobilePattern}$`);
  if (international) {
    if (!d.startsWith(country.dialCode)) return null;
    d = d.slice(country.dialCode.length);
  } else if (d.startsWith(country.dialCode) && !pattern.test(d.replace(/^0/, ""))) {
    d = d.slice(country.dialCode.length);
  }
  if (d.startsWith("0")) d = d.slice(1);
  return pattern.test(d) ? country.dialCode + d : null;
}
