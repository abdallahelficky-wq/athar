import { RequestHandler } from "express";

const SUPPORTED_LANGUAGES = ["ar", "en"] as const;
type Lang = (typeof SUPPORTED_LANGUAGES)[number];

/** يقرأ أول لغة مذكورة في رأس Accept-Language (يتجاهل q-values والمناطق الفرعية، مثلاً
 * "en-US" أو "en;q=0.9" تُقرَأ كـ "en") ويطابقها مع اللغات المدعومة، بافتراض العربية عند غياب
 * الرأس أو عدم التعرّف على قيمته — يحافظ هذا على السلوك الحالي لأي عميل لا يرسل الرأس أصلاً
 * (curl، اختبارات آلية، إلخ). */
function parseAcceptLanguage(header: string | undefined): Lang {
  if (!header) return "ar";
  const first = header.split(",")[0].trim().split(";")[0].split("-")[0].toLowerCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(first) ? (first as Lang) : "ar";
}

/** يحدّد لغة الاستجابة (رسائل الأخطاء والمحتوى الديناميكي) من رأس Accept-Language القياسي —
 * الواجهة الأمامية ترسله مطابقاً للغة الواجهة المختارة حالياً (i18n.language). */
export const resolveLanguage: RequestHandler = (req, _res, next) => {
  req.lang = parseAcceptLanguage(req.headers["accept-language"]);
  next();
};
