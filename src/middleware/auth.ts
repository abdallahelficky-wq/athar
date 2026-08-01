import { RequestHandler } from "express";
import { verifyAccessToken, verifyEmployeePortalToken } from "../lib/jwt";
import { unauthorized, forbidden } from "../lib/httpError";

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

/** يقيّد نقطة النهاية بأدوار معينة فقط، بعد المصادقة */
export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw unauthorized();
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
