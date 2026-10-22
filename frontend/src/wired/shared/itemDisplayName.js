/**
 * الاسم المعروض لصنف حسب لغة الواجهة — نفس قاعدة getAccountDisplayName (accountDisplayName.js): واجهة إنجليزية وللصنف nameEn
 * غير فارغ → nameEn، وإلا الاسم الأساسي (العربي). لا يُترجَم اسم أدخله المستخدم آلياً أبداً؛ يُختار الحقل المناسب فقط.
 *
 * للعرض في الشاشات فقط (القوائم، المنتقيات، التقارير). المستندات الصادرة لا تمرّ من هنا: الوصف المخزَّن على سطر الفاتورة/الإيصال
 * يبقى itemDescription (itemDefaults.js)، وقوالب الطباعة وXML زاتكا تتبع لغة المستند نفسه لا لغة الواجهة.
 */

const hasText = (value) => typeof value === "string" && value.trim() !== "";

/** الاسم الأساسي المعروض — يقبل صنفاً { name, nameEn } أو صف تقرير { itemName, itemNameEn } */
export function getItemDisplayName(item, language) {
  if (!item) return "";
  const name = item.name ?? item.itemName ?? "";
  const nameEn = item.nameEn ?? item.itemNameEn;
  return language === "en" && hasText(nameEn) ? nameEn.trim() : name;
}

/**
 * السطر الثانوي الصغير تحت الاسم: في الواجهة الإنجليزية الاسم العربي (حين يكون الأساسي nameEn)؛ في العربية nameEn كما اليوم.
 * null = لا سطر ثانوي (لا يتكرر الاسم نفسه مرتين).
 */
export function getItemSecondaryName(item, language) {
  if (!item) return null;
  const name = item.name ?? item.itemName ?? "";
  const nameEn = item.nameEn ?? item.itemNameEn;
  if (!hasText(nameEn)) return null;
  return language === "en" ? (hasText(name) ? name : null) : nameEn.trim();
}

/** اتجاه السطر الثانوي: عربي في الواجهة الإنجليزية، إنجليزي في العربية */
export const itemSecondaryDir = (language) => (language === "en" ? "rtl" : "ltr");

/** تسمية خيار في منتقٍ: الاسم المعروض مع الرمز */
export const itemOptionLabel = (item, language) => (item?.code ? `${getItemDisplayName(item, language)} (${item.code})` : getItemDisplayName(item, language));

/**
 * وحدات القياس الشائعة بالعربية ومقابلها للعرض في الواجهة الإنجليزية فقط. الوحدة نص حرّ يكتبه المستخدم: ما ليس في القاموس
 * يُعرض كما كُتب، ولا تُغيَّر القيمة المخزَّنة أبداً.
 */
export const UNIT_LABELS_EN = Object.freeze({
  "كجم": "kg",
  "كيلو": "kg",
  "كيلوجرام": "kg",
  "كغ": "kg",
  "جرام": "g",
  "غرام": "g",
  "جم": "g",
  "طن": "ton",
  "لتر": "L",
  "مل": "mL",
  "قطعة": "pcs",
  "حبة": "pcs",
  "كرتون": "carton",
  "علبة": "box",
  "صندوق": "box",
  "كيس": "bag",
  "متر": "m",
  "م": "m",
  "سم": "cm",
  "متر مربع": "m²",
  "م2": "m²",
  "متر مكعب": "m³",
  "م3": "m³",
  "ماسورة": "pipe",
  "لفة": "roll",
  "أمر": "order",
  "ساعة": "hour",
  "يوم": "day",
  "شهر": "month",
  "سنة": "year",
  "خدمة": "service",
  "طقم": "set",
  "زوج": "pair",
  "دزينة": "dozen",
});

/** الوحدة المعروضة: في الواجهة الإنجليزية مقابلها من القاموس إن وُجد، وإلا كما كُتبت؛ في العربية كما كُتبت دائماً */
export function getUnitDisplayLabel(unit, language) {
  if (!hasText(unit)) return unit ?? "";
  if (language !== "en") return unit;
  return UNIT_LABELS_EN[unit.trim()] ?? unit;
}
