// قائمة الدول العربية المدعومة وعملة كل دولة الافتراضية — تُطابق src/lib/countries.ts بالباك إند
// تماماً (لا يوجد كود مشترك بين المشروعين، فهذا نسخ مقصود). إضافة دولة جديدة مستقبلاً تتطلب
// تحديث الملفّين معاً.
export const COUNTRIES = [
  { code: "SA", nameAr: "السعودية", nameEn: "Saudi Arabia", defaultCurrency: "SAR", dialCode: "966", mobilePattern: "5\\d{8}", mobileExample: "0512345678", defaultVatRate: 15, vatNumberPattern: "3\\d{13}3", vatNumberExample: "300000000000003" },
  { code: "AE", nameAr: "الإمارات", nameEn: "United Arab Emirates", defaultCurrency: "AED", dialCode: "971", mobilePattern: "5\\d{8}", mobileExample: "0501234567", defaultVatRate: 5, vatNumberPattern: "\\d{15}", vatNumberExample: "100000000000003" },
  { code: "EG", nameAr: "مصر", nameEn: "Egypt", defaultCurrency: "EGP", dialCode: "20", mobilePattern: "1[0125]\\d{8}", mobileExample: "01012345678", defaultVatRate: 14, vatNumberPattern: "\\d{9}", vatNumberExample: "100-531-385" },
  { code: "KW", nameAr: "الكويت", nameEn: "Kuwait", defaultCurrency: "KWD", dialCode: "965", mobilePattern: "[569]\\d{7}", mobileExample: "51234567", defaultVatRate: 0, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "QA", nameAr: "قطر", nameEn: "Qatar", defaultCurrency: "QAR", dialCode: "974", mobilePattern: "[3567]\\d{7}", mobileExample: "33123456", defaultVatRate: 0, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "BH", nameAr: "البحرين", nameEn: "Bahrain", defaultCurrency: "BHD", dialCode: "973", mobilePattern: "[36]\\d{7}", mobileExample: "36123456", defaultVatRate: 10, vatNumberPattern: "\\d{15}", vatNumberExample: "200000000000003" },
  { code: "OM", nameAr: "عُمان", nameEn: "Oman", defaultCurrency: "OMR", dialCode: "968", mobilePattern: "[79]\\d{7}", mobileExample: "92123456", defaultVatRate: 5, vatNumberPattern: "OM\\d{10}", vatNumberExample: "OM1100000000" },
  { code: "JO", nameAr: "الأردن", nameEn: "Jordan", defaultCurrency: "JOD", dialCode: "962", mobilePattern: "7[789]\\d{7}", mobileExample: "0791234567", defaultVatRate: 16, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "IQ", nameAr: "العراق", nameEn: "Iraq", defaultCurrency: "IQD", dialCode: "964", mobilePattern: "7\\d{9}", mobileExample: "07701234567", defaultVatRate: 0, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "DZ", nameAr: "الجزائر", nameEn: "Algeria", defaultCurrency: "DZD", dialCode: "213", mobilePattern: "[567]\\d{8}", mobileExample: "0551234567", defaultVatRate: 19, vatNumberPattern: "\\d{15}(?:\\d{5})?", vatNumberExample: "416001000000007" },
  { code: "MA", nameAr: "المغرب", nameEn: "Morocco", defaultCurrency: "MAD", dialCode: "212", mobilePattern: "[67]\\d{8}", mobileExample: "0612345678", defaultVatRate: 20, vatNumberPattern: "\\d{15}", vatNumberExample: "001561191000066" },
  { code: "TN", nameAr: "تونس", nameEn: "Tunisia", defaultCurrency: "TND", dialCode: "216", mobilePattern: "[2459]\\d{7}", mobileExample: "20123456", defaultVatRate: 19, vatNumberPattern: "\\d{7}[A-HJ-NP-TV-Z](?:[ABDNP][MPCNE]\\d{3})?", vatNumberExample: "1234567MAE000" },
  { code: "LB", nameAr: "لبنان", nameEn: "Lebanon", defaultCurrency: "LBP", dialCode: "961", mobilePattern: "(?:3\\d{6}|(?:7\\d|81)\\d{6})", mobileExample: "03123456", defaultVatRate: 11, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "LY", nameAr: "ليبيا", nameEn: "Libya", defaultCurrency: "LYD", dialCode: "218", mobilePattern: "9[1-6]\\d{7}", mobileExample: "0912345678", defaultVatRate: 0, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "SD", nameAr: "السودان", nameEn: "Sudan", defaultCurrency: "SDG", dialCode: "249", mobilePattern: "[19]\\d{8}", mobileExample: "0912345678", defaultVatRate: 17, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "YE", nameAr: "اليمن", nameEn: "Yemen", defaultCurrency: "YER", dialCode: "967", mobilePattern: "7\\d{8}", mobileExample: "712345678", defaultVatRate: 5, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
  { code: "PS", nameAr: "فلسطين", nameEn: "Palestine", defaultCurrency: "JOD", dialCode: "970", mobilePattern: "5[69]\\d{7}", mobileExample: "0591234567", defaultVatRate: 16, vatNumberPattern: "[A-Z0-9]{5,20}", vatNumberExample: "" },
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

/** نسبة الضريبة القياسية المقترحة لدولة (مطابقة لـ defaultVatRateForCountry في الخادم) — 0 لدولة بلا ضريبة عامة. */
export function defaultVatRateForCountry(countryCode) {
  return COUNTRY_BY_CODE.get(countryCode)?.defaultVatRate ?? 15;
}

/** توحيد الرقم الضريبي — مطابق لـ normalizeVatNumber في الخادم (src/lib/vatNumber.ts). */
export function normalizeVatNumber(input) {
  return String(input ?? "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[\s\-./]/g, "").toUpperCase();
}

/** هل الرقم الضريبي (موحَّداً) بصيغة الدولة؟ الخادم هو الحَكَم. */
export function isValidVatNumberForCountry(value, countryCode) {
  const info = COUNTRY_BY_CODE.get(countryCode || "SA");
  return !!info && new RegExp(`^${info.vatNumberPattern}$`).test(normalizeVatNumber(value));
}

export function vatNumberExampleForCountry(countryCode) {
  return COUNTRY_BY_CODE.get(countryCode || "SA")?.vatNumberExample || "";
}
