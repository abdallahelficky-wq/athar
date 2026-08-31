import { RequestHandler } from "express";
import { verifyAccessToken, verifyEmployeePortalToken } from "../lib/jwt";
import { unauthorized, forbidden } from "../lib/httpError";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import type { ActionLevel } from "../lib/platformActions";

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

/** true لو كان صاحب الطلب مالك الشركة (Tenant.ownerId) نفسه — يملك دائماً كل الصلاحيات على شركته
 * بلا حاجة لإعداد منصب له صراحةً. super_admin (المنصّة) ليس مالك أي شركة بهذا المعنى، لكنه يمرّ
 * دائماً من requirePermission أدناه عبر استثنائه المنفصل، بنفس أسلوب requireRole تماماً. */
async function isTenantOwner(auth: { sub: string; tenantId: string }): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { ownerId: true } });
  return tenant?.ownerId === auth.sub;
}

/**
 * يقيّد نقطة نهاية بصلاحية دقيقة (مصفوفة منصب المستخدم PositionPermission) بدل دور ثابت — المرحلة
 * الأولى من نظام صلاحيات المناصب القابل للتخصيص لكل شركة (بديل تدريجي لـ requireRole لبعض
 * الإجراءات الحسّاسة). moduleId يطابق PLATFORM_MODULE_IDS، وaction إمّا أحد الأعمدة القياسية
 * (read/create/delete/approve) أو مفتاح حرّ داخل عمود extra JSON (مثال: "unpost") للصلاحيات غير
 * القياسية الخاصة بوحدة واحدة، بلا حاجة لعمود/migration جديد لكل صلاحية استثنائية تُضاف مستقبلاً.
 *
 * ملاحظة أداء: خلافاً لـ requireRole المتزامن تماماً (فحص JWT فقط)، هذا الحارس غير متزامن (استعلامان
 * إضافيان لقاعدة البيانات كحد أقصى) — مقبول للمرحلة الأولى المحدودة النطاق (مسار واحد فقط حالياً).
 */
export function requirePermission(moduleId: string, action: string): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) throw unauthorized();
    if (req.auth.role === "super_admin") return next();
    if (await isTenantOwner(req.auth)) return next();

    const user = await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { positionId: true } });
    const permission = user?.positionId
      ? await prisma.positionPermission.findUnique({
          where: { positionId_moduleId: { positionId: user.positionId, moduleId } },
        })
      : null;

    const standardColumns = ["read", "create", "delete", "approve"] as const;
    const allowed = (standardColumns as readonly string[]).includes(action)
      ? Boolean(permission?.[`can${action[0].toUpperCase()}${action.slice(1)}` as "canRead"])
      : Boolean((permission?.extra as Record<string, boolean> | null | undefined)?.[action]);

    if (!allowed) throw forbidden("منصبك الوظيفي لا يملك صلاحية تنفيذ هذا الإجراء");
    next();
  };
}

/** رتبة كل مستوى ترتيبي — none أدنى شيء (0)، full أعلاه (4). المقارنة تحدث هنا في كود التطبيق دائماً،
 * لا عبر ترتيب Postgres لقيم enum PermissionLevel. */
const LEVEL_RANK: Record<ActionLevel, number> = { none: 0, read: 1, edit: 2, approve: 3, full: 4 };

/**
 * يقيّد نقطة نهاية بمستوى ترتيبي دقيق (PositionActionPermission/UserActionPermissionOverride) —
 * الشكل الثاني (الترتيبي) من نظام صلاحيات المناصب، بديل تدريجي لـ requirePermission البوليانية أعلاه،
 * وحدة واحدة في كل مرة (راجع PLATFORM_ACTIONS في lib/platformActions.ts). منطق الفحص:
 *   1. super_admin → مسموح دائماً (كـ requireRole/requirePermission تماماً)
 *   2. مالك الشركة (Tenant.ownerId) → مسموح دائماً (يُعامَل كـ "full")
 *   3. استثناء فردي للمستخدم على هذا الإجراء تحديداً (UserActionPermissionOverride) إن وُجد → يُستخدم
 *      مستواه مباشرة (نهائي، يتغلّب على صلاحية المنصب سواء كان أعلى أو أقل منها)
 *   4. وإلا صلاحية منصب المستخدم على هذا الإجراء (PositionActionPermission) إن وُجدت
 *   5. وإلا "none" افتراضياً (مرفوض/مخفي — رفض آمن افتراضي)
 * يُسمَح فقط إن كانت رتبة المستوى المُحلَّل >= رتبة minLevel المطلوبة لهذا الـroute تحديداً.
 */
export function requireActionPermission(moduleId: string, actionId: string, minLevel: ActionLevel): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) throw unauthorized();
    if (req.auth.role === "super_admin") return next();
    if (await isTenantOwner(req.auth)) return next();

    const override = await prisma.userActionPermissionOverride.findUnique({
      where: { userId_moduleId_actionId: { userId: req.auth.sub, moduleId, actionId } },
    });

    let level: ActionLevel = "none";
    if (override) {
      level = override.level as ActionLevel;
    } else {
      const user = await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { positionId: true } });
      if (user?.positionId) {
        const permission = await prisma.positionActionPermission.findUnique({
          where: { positionId_moduleId_actionId: { positionId: user.positionId, moduleId, actionId } },
        });
        if (permission) level = permission.level as ActionLevel;
      }
    }

    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
      throw forbidden("منصبك الوظيفي لا يملك صلاحية تنفيذ هذا الإجراء");
    }
    next();
  };
}

/** يقصر الوصول على مالك الشركة (Tenant.ownerId) وsuper_admin فقط — لإدارة المناصب وصلاحياتها نفسها،
 * التي يجب أن تبقى بيد مالك الشركة حصرياً (وليس أي admin عادي آخر داخل نفس الشركة). */
export const requireTenantOwner: RequestHandler = async (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  if (req.auth.role === "super_admin") return next();
  if (!(await isTenantOwner(req.auth))) {
    throw forbidden("هذا الإجراء متاح فقط لمالك الشركة");
  }
  next();
};
