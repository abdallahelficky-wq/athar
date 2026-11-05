// قائمة الدول العربية المدعومة وعملة كل دولة الافتراضية — تُطابق src/lib/countries.ts بالباك إند
// تماماً (لا يوجد كود مشترك بين المشروعين، فهذا نسخ مقصود). إضافة دولة جديدة مستقبلاً تتطلب
// تحديث الملفّين معاً.
export const COUNTRIES = [
  { code: "SA", nameAr: "السعودية", nameEn: "Saudi Arabia", defaultCurrency: "SAR", dialCode: "966", mobilePattern: "5\\d{8}", mobileExample: "0512345678" },
  { code: "AE", nameAr: "الإمارات", nameEn: "United Arab Emirates", defaultCurrency: "AED", dialCode: "971", mobilePattern: "5\\d{8}", mobileExample: "0501234567" },
  { code: "EG", nameAr: "مصر", nameEn: "Egypt", defaultCurrency: "EGP", dialCode: "20", mobilePattern: "1[0125]\\d{8}", mobileExample: "01012345678" },
  { code: "KW", nameAr: "الكويت", nameEn: "Kuwait", defaultCurrency: "KWD", dialCode: "965", mobilePattern: "[569]\\d{7}", mobileExample: "51234567" },
  { code: "QA", nameAr: "قطر", nameEn: "Qatar", defaultCurrency: "QAR", dialCode: "974", mobilePattern: "[3567]\\d{7}", mobileExample: "33123456" },
  { code: "BH", nameAr: "البحرين", nameEn: "Bahrain", defaultCurrency: "BHD", dialCode: "973", mobilePattern: "[36]\\d{7}", mobileExample: "36123456" },
  { code: "OM", nameAr: "عُمان", nameEn: "Oman", defaultCurrency: "OMR", dialCode: "968", mobilePattern: "[79]\\d{7}", mobileExample: "92123456" },
  { code: "JO", nameAr: "الأردن", nameEn: "Jordan", defaultCurrency: "JOD", dialCode: "962", mobilePattern: "7[789]\\d{7}", mobileExample: "0791234567" },
  { code: "IQ", nameAr: "العراق", nameEn: "Iraq", defaultCurrency: "IQD", dialCode: "964", mobilePattern: "7\\d{9}", mobileExample: "07701234567" },
  { code: "DZ", nameAr: "الجزائر", nameEn: "Algeria", defaultCurrency: "DZD", dialCode: "213", mobilePattern: "[567]\\d{8}", mobileExample: "0551234567" },
  { code: "MA", nameAr: "المغرب", nameEn: "Morocco", defaultCurrency: "MAD", dialCode: "212", mobilePattern: "[67]\\d{8}", mobileExample: "0612345678" },
  { code: "TN", nameAr: "تونس", nameEn: "Tunisia", defaultCurrency: "TND", dialCode: "216", mobilePattern: "[2459]\\d{7}", mobileExample: "20123456" },
  { code: "LB", nameAr: "لبنان", nameEn: "Lebanon", defaultCurrency: "LBP", dialCode: "961", mobilePattern: "(?:3\\d{6}|(?:7\\d|81)\\d{6})", mobileExample: "03123456" },
  { code: "LY", nameAr: "ليبيا", nameEn: "Libya", defaultCurrency: "LYD", dialCode: "218", mobilePattern: "9[1-6]\\d{7}", mobileExample: "0912345678" },
  { code: "SD", nameAr: "السودان", nameEn: "Sudan", defaultCurrency: "SDG", dialCode: "249", mobilePattern: "[19]\\d{8}", mobileExample: "0912345678" },
  { code: "YE", nameAr: "اليمن", nameEn: "Yemen", defaultCurrency: "YER", dialCode: "967", mobilePattern: "7\\d{8}", mobileExample: "712345678" },
  { code: "PS", nameAr: "فلسطين", nameEn: "Palestine", defaultCurrency: "JOD", dialCode: "970", mobilePattern: "5[69]\\d{7}", mobileExample: "0591234567" },
];

export const CURRENCIES = [
  { code: "SAR", symbolAr: "ر.س", nameEn: "Saudi Riyal" },
  { code: "AED", symbolAr: "د.إ", nameEn: "UAE Dirham" },
  { code: "EGP", symbolAr: "ج.م", nameEn: "Egyptian Pound" },
  { code: "KWD", symbolAr: "د.ك", nameEn: "Kuwaiti Dinar" },
  { code: "QAR", symbolAr: "ر.ق", nameEn: "Qatari Riyal" },
  { code: "BHD", symbolAr: "د.ب", nameEn: "Bahraini Dinar" },
  { code: "OMR", symbolAr: "ر.ع.", nameEn: "Omani Rial" },
  { code: "JOD", symbolAr: "د.أ", nameEn: "Jordanian Dinar" },
  { code: "IQD", symbolAr: "د.ع", nameEn: "Iraqi Dinar" },
  { code: "DZD", symbolAr: "د.ج", nameEn: "Algerian Dinar" },
  { code: "MAD", symbolAr: "د.م.", nameEn: "Moroccan Dirham" },
  { code: "TND", symbolAr: "د.ت", nameEn: "Tunisian Dinar" },
  { code: "LBP", symbolAr: "ل.ل", nameEn: "Lebanese Pound" },
  { code: "LYD", symbolAr: "د.ل", nameEn: "Libyan Dinar" },
  { code: "SDG", symbolAr: "ج.س", nameEn: "Sudanese Pound" },
  { code: "YER", symbolAr: "ر.ي", nameEn: "Yemeni Rial" },
];

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));
const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryName(code, lang = "ar") {
  const info = COUNTRY_BY_CODE.get(code);
  if (!info) return code || "";
  return lang === "en" ? info.nameEn : info.nameAr;
}

/** التسمية المعروضة لعملة مُعطاة بحسب لغة الواجهة — نفس منطق currencyLabel() بالباك إند. */
export function currencyLabel(code, lang = "ar") {
  const info = code ? CURRENCY_BY_CODE.get(code) : undefined;
  if (!info) return code || (lang === "en" ? "SAR" : "ر.س");
  return lang === "en" ? info.code : info.symbolAr;
}

export function defaultCurrencyForCountry(countryCode) {
  return COUNTRY_BY_CODE.get(countryCode)?.defaultCurrency || "SAR";
}
