/**
 * الفترة الافتراضية لأي شاشة فلترة بتاريخ (كشف حساب الأستاذ، ميزان المراجعة...) عند ضبط إقفال
 * سنة مالية لهذه الشركة: من اليوم التالي لتاريخ الإقفال إلى اليوم، بدل الفترة الفارغة (كل التاريخ)
 * المعتادة — يبقى الفلتر قابلاً للتغيير يدوياً لعرض فترات مُقفلة (عرض فقط، بلا أي تعديل يقبله
 * الخادم). بلا إقفال مضبوط، تُعاد نفس القيم الافتراضية المُمرَّرة (السلوك الحالي بلا أي تغيير).
 */
export function defaultDateRangeForCompany(company, fallback) {
  if (!company?.fiscalYearClosingDate) return fallback;
  const closing = new Date(company.fiscalYearClosingDate);
  const dayAfter = new Date(closing.getTime() + 86_400_000);
  const today = new Date();
  return { ...fallback, dateFrom: dayAfter.toISOString().slice(0, 10), dateTo: today.toISOString().slice(0, 10) };
}
