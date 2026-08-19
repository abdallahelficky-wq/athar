// ترتيب يوم/شهر/سنة موحّد في الحالتين (بدل month/day/year الأمريكي)، بأسماء/أرقام تحترم اللغة
// الحالية — ar-SA كما كانت الشاشات المُترجَمة تستخدمها دائماً، en-GB لنفس ترتيب الحقول بالإنجليزية.
const LOCALE_BY_LANGUAGE = { ar: "ar-SA", en: "en-GB" };

export function formatDate(date, lang, opts) {
  if (!date) return "";
  const locale = LOCALE_BY_LANGUAGE[lang] || LOCALE_BY_LANGUAGE.ar;
  return new Date(date).toLocaleDateString(locale, opts);
}

export function formatDateTime(date, lang, opts) {
  if (!date) return "";
  const locale = LOCALE_BY_LANGUAGE[lang] || LOCALE_BY_LANGUAGE.ar;
  return new Date(date).toLocaleString(locale, opts);
}
