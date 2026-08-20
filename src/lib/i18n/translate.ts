import { AR_TO_EN } from "./errorMessages";

export type Lang = "ar" | "en";

/** يترجم نصاً عربياً إلى الإنجليزية عبر قاموس AR_TO_EN — أي نص غير موجود بالقاموس (رسالة تفاعلية
 * لم تُحوَّل بعد، أو نص لم يُكتشَف) يُعاد كما هو بالعربية بدل كسر الاستجابة. */
export function translateMessage(text: string, lang: Lang): string {
  if (lang !== "en") return text;
  return AR_TO_EN[text] ?? text;
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
