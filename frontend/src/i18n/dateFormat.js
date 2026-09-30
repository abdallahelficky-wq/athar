// ترتيب يوم/شهر/سنة موحّد في الحالتين (بدل month/day/year الأمريكي)، بأسماء/أرقام تحترم اللغة
// الحالية — ar-SA كما كانت الشاشات المُترجَمة تستخدمها دائماً، en-GB لنفس ترتيب الحقول بالإنجليزية.
const LOCALE_BY_LANGUAGE = { ar: "ar-SA", en: "en-GB" };

// التقويم الميلادي والأرقام اللاتينية إلزاماً في كل تاريخ يُعرَض أو يُطبَع أو يُصدَّر: التقويم الافتراضي
// لـ"ar-SA" يختلف باختلاف نسخة ICU — هجري (أم القرى) في Chromium، وميلادي في Node الحالي — فلا يُترَك
// للمحرّك. القيود والدفاتر والإقرارات الضريبية كلها ميلادية، ومستند مطبوع بتاريخ هجري لا يطابق محتواه.
const GREGORIAN = { calendar: "gregory", numberingSystem: "latn" };

export function formatDate(date, lang, opts) {
  if (!date) return "";
  const locale = LOCALE_BY_LANGUAGE[lang] || LOCALE_BY_LANGUAGE.ar;
  return new Date(date).toLocaleDateString(locale, { ...GREGORIAN, ...opts });
}

export function formatDateTime(date, lang, opts) {
  if (!date) return "";
  const locale = LOCALE_BY_LANGUAGE[lang] || LOCALE_BY_LANGUAGE.ar;
  return new Date(date).toLocaleString(locale, { ...GREGORIAN, ...opts });
}

export function formatTime(date, lang, opts) {
  if (!date) return "";
  const locale = LOCALE_BY_LANGUAGE[lang] || LOCALE_BY_LANGUAGE.ar;
  return new Date(date).toLocaleTimeString(locale, { ...GREGORIAN, ...opts });
}

/**
 * نسخة إلزامية التقويم الميلادي والأرقام اللاتينية — كشف اختبار حقيقي على جهاز Sunmi V2 أن
 * toLocaleString("ar-SA") العادية (formatDateTime أعلاه) تطبع تاريخاً هجرياً صامتاً ("١٤٤٦/٤/١٤
 * هـ")، لأن التقويم الافتراضي لِلغة "ar-SA" في محركات ICU/V8 هو الهجري (أم القرى) لا الميلادي كما
 * قد يُفتَرض؛ calendar/numberingSystem هنا يفرضان الميلادي والأرقام الغربية صراحةً بدل الاعتماد على
 * افتراض المحرك. تُستخدَم فقط حيث يكون التاريخ الميلادي إلزاماً قانونياً لا مجرد تفضيل عرض (إيصال
 * نقطة البيع الحراري ومعاينته على الشاشة — راجع escpos.js/ReceiptView.jsx — لأن BT-2 في مواصفة
 * زاتكا للفوترة الإلكترونية تاريخ ميلادي إلزاماً)، لا لاستبدال formatDateTime العامة في بقية شاشات
 * المنصة التي لم يُبلَّغ عن مشكلة فيها. */
export function formatGregorianDateTime(date, lang, opts) {
  if (!date) return "";
  const locale = LOCALE_BY_LANGUAGE[lang] || LOCALE_BY_LANGUAGE.ar;
  return new Date(date).toLocaleString(locale, { ...GREGORIAN, ...opts });
}
