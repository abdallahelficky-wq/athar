/**
 * ترجمة العرض فقط لقيم القوائم الثابتة القديمة (DEPARTMENTS, LEAVE_TYPES, ASSET_CATEGORIES,
 * NATIONALITIES, EMPLOYEE_DOC_TYPES في constants.js/hr.jsx) — القيمة المخزَّنة في قاعدة البيانات
 * والمُرسَلة للخادم تبقى دائماً النص العربي الأصلي حرفياً بلا أي تغيير؛ هذه الدالة تُستخدَم حصراً
 * لتحديد النص الظاهر للمستخدم (children العنصر <option>)، لا القيمة (value) التي تُخزَّن.
 *
 * fallback إلزامي: أي قيمة مخزَّنة فعلياً لا يوجد لها مفتاح في الخريطة المُمرَّرة (بيانات قديمة،
 * أو اختلاف طفيف في المسافات/الإملاء لم تلتقطه الخريطة) تُعرَض بنصها الأصلي كما هي — لا تُترجَم
 * ولا تظهر فارغة أبداً.
 */
export function labelForListValue(t, keyMap, i18nPrefix, value) {
  const key = keyMap[value];
  return key ? t(`${i18nPrefix}.${key}`) : value;
}
