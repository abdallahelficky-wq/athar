import { RequestHandler } from "express";
import { verifyAccessToken, verifyEmployeePortalToken } from "../lib/jwt";
import { unauthorized, forbidden } from "../lib/httpError";
import { env } from "../config/env";

/** يتحقق من رمز JWT (access token) ويحمّل هوية المستخدم + المستأجر في req.auth */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("رمز الدخول مفقود");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    throw unauthorized("رمز الدخول غير صالح أو منتهي الصلاحية");
  }
};

/**
 * يتحقق من رمز بوابة الموظف (تطبيق الجوال) — موقّع بسرّ منفصل تماماً عن رموز User الإدارية،
 * فلا يمكن لهذا الرمز أن يُقبَل أبداً في مسارات authenticate العادية أو العكس.
 */
export const authenticateEmployeePortal: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("رمز الدخول مفقود");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.employeeAuth = verifyEmployeePortalToken(token);
    next();
  } catch {
    throw unauthorized("رمز الدخول غير صالح أو منتهي الصلاحية");
  }
};

/**
 * يتحقق من سرّ مشترك ثابت (PLATFORM_ADMIN_API_KEY) بدل أي رمز JWT — لمسارات /api/platform-admin/*
 * فقط، التي يستدعيها حصرياً تطبيق "athar-platform-admin" المنفصل تماماً (مستودع كود وقاعدة
 * بيانات مستقلَّين). لا هوية مستخدم/مستأجر هنا إطلاقاً (بخلاف authenticate/authenticateEmployeePortal
 * أعلاه) — هذه ثقة على مستوى الخدمة نفسها (service-to-service) لا مستوى مستخدم. Fail closed: لو
 * PLATFORM_ADMIN_API_KEY غير مضبوط في env أصلاً، تُرفَض كل الطلبات دائماً (لا قيمة افتراضية).
 */
export const authenticatePlatformService: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized("رمز الدخول مفقود");
  const key = header.slice("Bearer ".length);
  if (!env.platformAdminApiKey || key !== env.platformAdminApiKey) {
    throw unauthorized("رمز الدخول غير صالح");
  }
  next();
};

/**
 * يقيّد نقطة النهاية بأدوار معينة فقط، بعد المصادقة.
 * دور super_admin (الحساب المالك الوحيد) يتضمن دائماً كل صلاحيات أي دور آخر تلقائياً ويمرّ من
 * أي بوابة requireRole أياً كانت الأدوار المذكورة فيها — فيما عدا القوائم غير الفارغة التي لا
 * تتضمنه أصلاً هو نفسه بالاسم بديهياً (requireRole("super_admin") يبقى حصرياً عليه فقط، بما أنه
 * الدور الوحيد في القائمة). بدون هذا الاستثناء، أي بوابة تفحص أدواراً أخرى فقط (مثل "admin" أو
 * "finance_manager") كانت سترفض حساب super_admin رغم أنه من المفترض أن يملك صلاحيات admin وأكثر —
 * وهذا بالضبط ما حدث فعلياً بعد ترقية الحساب المالك لدور super_admin.
 */
export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw unauthorized();
    if (req.auth.role === "super_admin") return next();
    if (!roles.includes(req.auth.role)) {
      throw forbidden("دورك الوظيفي لا يسمح بتنفيذ هذا الإجراء");
    }
    next();
  };
}

/** يتحقق أن نطاق شركة المستخدم (companyScope) يسمح له بالوصول لهذه الشركة تحديداً */
export function assertCompanyAccess(auth: { companyScope: string }, companyId: string) {
  if (auth.companyScope !== "all" && auth.companyScope !== companyId) {
    throw forbidden("لا تملك صلاحية الوصول لبيانات هذه الشركة");
  }
}
