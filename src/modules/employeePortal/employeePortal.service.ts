import { prisma } from "../../lib/prisma";
import { unauthorized, tooManyRequests } from "../../lib/httpError";
import { hashPassword, verifyPassword } from "../../lib/password";
import { signEmployeePortalToken } from "../../lib/jwt";
import { isIpThrottled, recordIpFailure } from "./loginThrottle";

export const MAX_FAILED_ATTEMPTS = 5;
/** مدة أول قفل؛ كل قفل تالٍ ضعف سابقه حتى الحدّ الأقصى أدناه */
export const BASE_LOCK_MS = 15 * 60_000;
export const MAX_LOCK_MS = 24 * 60 * 60_000;

/**
 * رسالة دخول عامة موحّدة لكل حالات الفشل — رمز منشأة غير موجود، رقم غير مسجَّل، PIN خاطئ، أو حساب
 * مقفل حالياً — بنفس كود الحالة ونفس الزمن تقريباً (مقارنة bcrypt وهمية في المسارات التي لا تقارن
 * فعلياً)، فلا يستطيع من يجرّب أن يعرف هل الحساب موجود أو مقفل.
 */
export const INVALID_LOGIN_MESSAGE = "رقم الجوال أو الرمز السري غير صحيح";
const THROTTLED_MESSAGE = "محاولات دخول فاشلة كثيرة من هذا الجهاز، حاول مرة أخرى بعد قليل";

let dummyHash: Promise<string> | null = null;
/** مقارنة تستهلك نفس زمن bcrypt الحقيقي تقريباً في المسارات التي لا يوجد فيها PIN لمقارنته */
async function burnComparisonTime(pin: string) {
  dummyHash ??= hashPassword("portal-login-timing-equaliser");
  await verifyPassword(pin, await dummyHash);
}

/** مدة القفل رقم n (1 = أول قفل): 15د، 30د، 1س، 2س... حتى 24 ساعة كحد أقصى */
export function lockDurationMs(lockoutNumber: number): number {
  return Math.min(BASE_LOCK_MS * 2 ** Math.max(lockoutNumber - 1, 0), MAX_LOCK_MS);
}

/**
 * ما يكتبه الموظف في حقل "رمز المنشأة": الرمز الرقمي الجديد (Tenant.code، مثال 1000001)، أو المعرّف
 * القديم (Tenant.id) الذي حفظته التطبيقات المثبَّتة والهواتف مسبقاً — كلاهما يعمل. رقم أطول من 9 أرقام
 * لا يطابق أي رمز (عمود Int) فيُعامَل كرمز غير موجود بدل خطأ خادم.
 */
export async function resolvePortalTenant(identifier: string) {
  const value = identifier.trim();
  if (/^\d+$/.test(value)) {
    if (value.length > 9) return null;
    return prisma.tenant.findUnique({ where: { code: Number(value) } });
  }
  return prisma.tenant.findUnique({ where: { id: value } });
}

export async function employeePortalLogin(tenantIdentifier: string, phone: string, pin: string, ip = "unknown") {
  if (await isIpThrottled(ip)) throw tooManyRequests(THROTTLED_MESSAGE);

  const fail = async () => {
    await recordIpFailure(ip);
    return unauthorized(INVALID_LOGIN_MESSAGE);
  };

  const tenant = await resolvePortalTenant(tenantIdentifier);
  const employee = tenant
    ? await prisma.employee.findFirst({
        where: { tenantId: tenant.id, phone: phone.trim(), portalActive: true, status: "active" },
        omit: { pinHash: false },
      })
    : null;

  if (!tenant || !employee || !employee.pinHash) {
    await burnComparisonTime(pin);
    throw await fail();
  }

  // مقفل حالياً: نفس الرد ونفس الزمن تماماً كـ PIN خاطئ، ولا تُقارَن المحاولة بالـ PIN الحقيقي أصلاً.
  if (employee.portalLockedUntil && employee.portalLockedUntil > new Date()) {
    await burnComparisonTime(pin);
    throw await fail();
  }

  const valid = await verifyPassword(pin, employee.pinHash);
  if (!valid) {
    // زيادة ذرّية؛ العدّاد لا يُصفَّر عند انتهاء القفل — فبعد أول قفل تُعيد كل محاولة خاطئة واحدة القفل
    // فوراً بمدة أطول (15د ← 30د ← 1س ...)، بدل 5 محاولات جديدة بعد كل قفل.
    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: { failedPortalLoginAttempts: { increment: 1 } },
      select: { failedPortalLoginAttempts: true, portalLockoutCount: true },
    });
    if (updated.failedPortalLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockoutNumber = updated.portalLockoutCount + 1;
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          portalLockoutCount: lockoutNumber,
          portalLockedUntil: new Date(Date.now() + lockDurationMs(lockoutNumber)),
        },
      });
    }
    throw await fail();
  }

  // بيانات دخول صحيحة لمنشأة معلَّقة إدارياً: رفض صريح (يظهر فقط لمن يعرف الرقم والـ PIN معاً).
  if (tenant.subscriptionStatus === "suspended") {
    throw unauthorized(tenantSuspendedMessage(tenant.suspensionReason));
  }

  await prisma.employee.update({
    where: { id: employee.id },
    data: { failedPortalLoginAttempts: 0, portalLockedUntil: null, portalLockoutCount: 0 },
  });

  // الرمز يحمل دائماً المعرّف الداخلي للمستأجر، أياً كان ما كتبه الموظف (رمزاً رقمياً أو المعرّف القديم).
  const accessToken = signEmployeePortalToken({ employeeId: employee.id, tenantId: tenant.id });
  return { accessToken, employee: await employeePortalProfile(employee.id, tenant.id) };
}

export function tenantSuspendedMessage(reason: string | null) {
  return reason
    ? `تم تعليق هذا الحساب من إدارة المنصة: ${reason}`
    : "تم تعليق هذا الحساب من إدارة المنصة، تواصل مع الدعم الفني";
}

/** ملف الموظف الآمن لبوابة الجوال — يستبعد عمداً الراتب/بيانات البنك (رمز أقل ثقة من حساب User) */
export async function employeePortalProfile(employeeId: string, tenantId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { id: true, name: true, jobTitle: true, department: true, companyId: true, assignedCostCenterId: true },
  });
  if (!employee) throw unauthorized("الحساب غير موجود");
  const directReportsCount = await prisma.employee.count({ where: { managerId: employeeId, tenantId } });
  return { ...employee, isManager: directReportsCount > 0 };
}
