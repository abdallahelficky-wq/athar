import { AR_TO_EN } from "./errorMessages";
import { DYNAMIC_MESSAGE_PATTERNS } from "./dynamicMessages";

export type Lang = "ar" | "en";

/** يترجم نصاً عربياً إلى الإنجليزية: مطابقة حرفية أولاً عبر AR_TO_EN (الرسائل الثابتة)، ثم مطابقة
 * نمطية عبر DYNAMIC_MESSAGE_PATTERNS (الرسائل التفاعلية بقيم ديناميكية). أي نص لا يطابق أياً منهما
 * (نادر — رسالة جديدة لم تُضَف بعد) يُعاد كما هو بالعربية بدل كسر الاستجابة. */
export function translateMessage(text: string, lang: Lang): string {
  if (lang !== "en") return text;
  if (text in AR_TO_EN) return AR_TO_EN[text];
  for (const { match, translate } of DYNAMIC_MESSAGE_PATTERNS) {
    const m = text.match(match);
    if (m) return translate(m.slice(1));
  }
  return text;
}

/** يمشي على تفاصيل خطأ Zod (نتيجة flatten()) ويترجم كل رسالة داخل formErrors/fieldErrors. */
export function translateZodDetails(details: unknown, lang: Lang): unknown {
  if (lang !== "en" || !details || typeof details !== "object") return details;
  const d = details as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
  if (!Array.isArray(d.formErrors) && typeof d.fieldErrors !== "object") return details;
  return {
    ...d,
    formErrors: Array.isArray(d.formErrors) ? d.formErrors.map((m) => translateMessage(m, lang)) : d.formErrors,
    fieldErrors: d.fieldErrors
      ? Object.fromEntries(
          Object.entries(d.fieldErrors).map(([field, messages]) => [
            field,
            Array.isArray(messages) ? messages.map((m) => translateMessage(m, lang)) : messages,
          ]),
        )
      : d.fieldErrors,
  };
}
