/**
 * لا يوجد حقل "بداية السنة المالية" مُهيَّأ لكل شركة في هذا النظام حالياً (Company.fiscalYearClosingDate
 * هو فقط تاريخ إقفال اختياري، لا شهر/يوم بداية سنة مالية) — السنة المالية هنا مطابقة دائماً للسنة
 * الميلادية (1 يناير). تُستخدَم لتعبئة نطاق التاريخ الافتراضي لروابط "كشف حساب العميل" التفصيلية.
 */
export function currentFiscalYearStartDateOnly() {
  return `${new Date().getFullYear()}-01-01`;
}

export function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}
