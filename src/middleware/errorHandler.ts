import { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/httpError";
import { Prisma } from "@prisma/client";
import { translateMessage, translateZodDetails } from "../lib/i18n/translate";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const lang = req.lang ?? "ar";

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: translateMessage(err.message, lang),
      details: translateZodDetails(err.details, lang),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: translateMessage("قيمة مكررة تنتهك قيداً فريداً", lang), details: err.meta });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: translateMessage("العنصر غير موجود", lang) });
      return;
    }
    if (err.code === "P2003") {
      res.status(409).json({ error: translateMessage("لا يمكن حذف هذا العنصر لارتباطه بسجلات أخرى", lang) });
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.error(formatUnexpectedErrorForLog(err));
  res.status(500).json({ error: translateMessage("خطأ داخلي في الخادم", lang) });
};

/**
 * يمنع أي خطأ غير متوقع من إغراق سجل الخادم (وتجاوز حد رسائل/ثانية عند مزوّدي الاستضافة مثل
 * Railway) — اكتُشف فعلياً أن Prisma تُضمِّن نسخة كاملة "منسَّقة" (pretty-printed) من كل عناصر
 * مصفوفة الإدخال في رسالة PrismaClientValidationError عند رفض قيمة واحدة فقط (مثال حقيقي: قيمة
 * تاريخ غير صالحة ضمن استيراد قيود بالجملة لآلاف السطور، أنتجت رسالة خطأ تجاوزت 300 ألف حرف/10,000
 * سطر، وأغرقت سجلات الإنتاج فعلياً). هذا التقصير عام لأي خطأ غير متوقع مستقبلاً، بصرف النظر عن
 * مصدره أو سببه — لا يعتمد على معالجة كل حالة استثناء على حدة.
 */
const MAX_LOGGED_ERROR_CHARS = 2000;
function formatUnexpectedErrorForLog(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message.length > MAX_LOGGED_ERROR_CHARS ? `${err.message.slice(0, MAX_LOGGED_ERROR_CHARS)}… (مقصوص، الطول الأصلي ${err.message.length} حرفاً)` : err.message,
      stack: err.stack?.slice(0, MAX_LOGGED_ERROR_CHARS),
    };
  }
  return err;
}
