// قائمة الدول العربية المدعومة وعملة كل دولة الافتراضية — نقطة مركزية واحدة يُبنى عليها التحقق
// (companies.schemas.ts) واقتراح العملة التلقائي عند اختيار الدولة بالواجهة الأمامية. إضافة دولة
// جديدة مستقبلاً تكون بإضافة سطر واحد هنا فقط.
export interface CountryInfo {
  code: string; // ISO 3166-1 alpha-2
  nameAr: string;
  nameEn: string;
  defaultCurrency: string; // ISO 4217 — القيمة المقترحة تلقائياً عند اختيار الدولة، قابلة للتعديل
  dialCode: string; // مفتاح الدولة الدولي بلا "+" (مصر 20)
  mobilePattern: string; // الرقم الوطني للجوال بلا مفتاح الدولة وبلا الصفر البادئ (regex كامل المطابقة)
  mobileExample: string; // مثال بالصيغة المحلية يُعرَض في النموذج
}

export const COUNTRIES: CountryInfo[] = [
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

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code) as [string, ...string[]];

export interface CurrencyInfo {
  code: string; // ISO 4217
  symbolAr: string; // اختصار عربي شائع — تسمية عرض فقط، لا يؤثر على أي حساب
  nameEn: string;
}

export const CURRENCIES: CurrencyInfo[] = [
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

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** التسمية المعروضة لعملة مُعطاة بحسب لغة الواجهة — يُستخدَم في كل مكان يعرض رمز العملة
 * (رسائل الأخطاء/الفواتير بالبريد/تنبيهات الداشبورد) بدل الاعتماد على "ر.س"/"SAR" ثابتة. */
export function currencyLabel(code: string | null | undefined, lang: "ar" | "en" = "ar"): string {
  const info = code ? CURRENCY_BY_CODE.get(code) : undefined;
  if (!info) return code || (lang === "en" ? "SAR" : "ر.س");
  return lang === "en" ? info.code : info.symbolAr;
}

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryInfo(code: string | null | undefined): CountryInfo | undefined {
  return code ? COUNTRY_BY_CODE.get(code) : undefined;
}

export function defaultCurrencyForCountry(code: string | null | undefined): string {
  return countryInfo(code)?.defaultCurrency || "SAR";
}
