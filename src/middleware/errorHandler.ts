import { ErrorRequestHandler, Request } from "express";
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
  console.error(formatUnexpectedErrorForLog(err), formatRequestContextForLog(req));
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

// أسماء حقول لا تُسجَّل أبداً حتى في سياق خطأ غير متوقع — كلمات مرور/أرقام PIN/مفاتيح خاصة/شهادات
// قد تظهر في جسم طلب أي مسار (فتح وردية بوابة موظف، فك ترحيل بـPIN، ضبط شهادات زاتكا...)، وهذا
// المُسجِّل عام لكل الوحدات لا خاص بمسار نقطة البيع وحده.
const REDACTED_BODY_KEYS = new Set(["password", "newPassword", "currentPassword", "pin", "secret", "privateKeyPem", "certificateBodyBase64", "token", "otp"]);

function redactBody(value: unknown, depth = 0): unknown {
  if (depth > 2 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactBody(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, v]) => [
      key,
      REDACTED_BODY_KEYS.has(key) ? "[محذوف]" : redactBody(v, depth + 1),
    ]),
  );
}

/**
 * سياق الطلب الذي أنتج هذا الخطأ غير المتوقَّع — الطريقة/المسار، هوية المستخدم (لوحة التحكم
 * الرئيسية عبر req.auth، أو بوابة الموظف عبر req.employeeAuth)، الشركة المستهدفة (إن ظهرت في
 * الاستعلام أو الجسم)، وجسم الطلب نفسه (بعد حجب الحقول الحسّاسة وقصّ طوله بنفس حد الخطأ نفسه) —
 * دون هذا، رسالة الخطأ وحدها لا تكفي لمعرفة *لأي شركة/مستخدم* حدث الفشل ولا *بأي بيانات* (مثال:
 * مسار نقطة البيع لا يظهر فيه تفصيل الدفعات إطلاقاً بدون هذا). لا يُغيِّر الرد المُعاد للعميل
 * (يبقى الرسالة العامة كما هي) — إضافة للتسجيل الخادمي فقط.
 */
function formatRequestContextForLog(req: Request) {
  const body = req.body as Record<string, unknown> | undefined;
  const companyId =
    (typeof req.query?.companyId === "string" && req.query.companyId) ||
    (body && typeof body === "object" && typeof body.companyId === "string" && body.companyId) ||
    undefined;
  return {
    method: req.method,
    path: req.originalUrl,
    tenantId: req.auth?.tenantId ?? req.employeeAuth?.tenantId,
    userId: req.auth?.sub,
    employeeId: req.employeeAuth?.employeeId,
    companyId,
    body: redactBody(body),
  };
}
