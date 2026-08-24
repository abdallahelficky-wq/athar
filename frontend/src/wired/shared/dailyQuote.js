/** رقم اليوم في السنة (1-366) بتوقيت جهاز المستخدم — أساس اختيار حتمي (وليس عشوائياً) لمقولة
 * اليوم، فتبقى نفس المقولة طوال اليوم لأي مستخدم يفتح النظام، وتتغيّر تلقائياً في اليوم التالي. */
function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diffMs = date - start;
  return Math.floor(diffMs / 86400000);
}

/** فهرس مقولة اليوم ضمن مصفوفة بأي طول (dashboard.dailyQuotes) — بلا أي طلب شبكة أو تخزين إضافي. */
export function dailyQuoteIndex(quotesLength, date = new Date()) {
  if (!quotesLength) return 0;
  return dayOfYear(date) % quotesLength;
}
