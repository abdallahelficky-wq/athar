// قائمة الدول العربية المدعومة وعملة كل دولة الافتراضية — نقطة مركزية واحدة يُبنى عليها التحقق
// (companies.schemas.ts) واقتراح العملة التلقائي عند اختيار الدولة بالواجهة الأمامية. إضافة دولة
// جديدة مستقبلاً تكون بإضافة سطر واحد هنا فقط.
export interface CountryInfo {
  code: string; // ISO 3166-1 alpha-2
  nameAr: string;
  nameEn: string;
  defaultCurrency: string; // ISO 4217 — القيمة المقترحة تلقائياً عند اختيار الدولة، قابلة للتعديل
}

export const COUNTRIES: CountryInfo[] = [
  { code: "SA", nameAr: "السعودية", nameEn: "Saudi Arabia", defaultCurrency: "SAR" },
  { code: "AE", nameAr: "الإمارات", nameEn: "United Arab Emirates", defaultCurrency: "AED" },
  { code: "EG", nameAr: "مصر", nameEn: "Egypt", defaultCurrency: "EGP" },
  { code: "KW", nameAr: "الكويت", nameEn: "Kuwait", defaultCurrency: "KWD" },
  { code: "QA", nameAr: "قطر", nameEn: "Qatar", defaultCurrency: "QAR" },
  { code: "BH", nameAr: "البحرين", nameEn: "Bahrain", defaultCurrency: "BHD" },
  { code: "OM", nameAr: "عُمان", nameEn: "Oman", defaultCurrency: "OMR" },
  { code: "JO", nameAr: "الأردن", nameEn: "Jordan", defaultCurrency: "JOD" },
  { code: "IQ", nameAr: "العراق", nameEn: "Iraq", defaultCurrency: "IQD" },
  { code: "DZ", nameAr: "الجزائر", nameEn: "Algeria", defaultCurrency: "DZD" },
  { code: "MA", nameAr: "المغرب", nameEn: "Morocco", defaultCurrency: "MAD" },
  { code: "TN", nameAr: "تونس", nameEn: "Tunisia", defaultCurrency: "TND" },
  { code: "LB", nameAr: "لبنان", nameEn: "Lebanon", defaultCurrency: "LBP" },
  { code: "LY", nameAr: "ليبيا", nameEn: "Libya", defaultCurrency: "LYD" },
  { code: "SD", nameAr: "السودان", nameEn: "Sudan", defaultCurrency: "SDG" },
  { code: "YE", nameAr: "اليمن", nameEn: "Yemen", defaultCurrency: "YER" },
  { code: "PS", nameAr: "فلسطين", nameEn: "Palestine", defaultCurrency: "JOD" },
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
