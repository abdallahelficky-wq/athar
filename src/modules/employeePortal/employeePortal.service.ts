import { prisma } from "../../lib/prisma";
import { unauthorized } from "../../lib/httpError";
import { verifyPassword } from "../../lib/password";
import { signEmployeePortalToken } from "../../lib/jwt";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60_000;

/** رسالة دخول عامة موحّدة لكل حالات الفشل — لا تكشف هل الرقم مسجَّل أصلاً أم لا */
const INVALID_LOGIN_MESSAGE = "رقم الجوال أو الرمز السري غير صحيح";

export async function employeePortalLogin(tenantId: string, phone: string, pin: string) {
  const employee = await prisma.employee.findFirst({
    where: { tenantId, phone, portalActive: true, status: "active" },
  });
  if (!employee || !employee.pinHash) throw unauthorized(INVALID_LOGIN_MESSAGE);

  if (employee.portalLockedUntil && employee.portalLockedUntil > new Date()) {
    throw unauthorized("تم قفل الدخول مؤقتاً بسبب محاولات خاطئة متكررة، حاول مرة أخرى لاحقاً");
  }

  const valid = await verifyPassword(pin, employee.pinHash);
  if (!valid) {
    const attempts = employee.failedPortalLoginAttempts + 1;
    const lockedOut = attempts >= MAX_FAILED_ATTEMPTS;
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        failedPortalLoginAttempts: lockedOut ? 0 : attempts,
        portalLockedUntil: lockedOut ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });
    throw unauthorized(INVALID_LOGIN_MESSAGE);
  }

  await prisma.employee.update({
    where: { id: employee.id },
    data: { failedPortalLoginAttempts: 0, portalLockedUntil: null },
  });

  const accessToken = signEmployeePortalToken({ employeeId: employee.id, tenantId });
  return { accessToken, employee: await employeePortalProfile(employee.id, tenantId) };
}

/** ملف الموظف الآمن لبوابة الجوال — يستبعد عمداً الراتب/بيانات البنك (رمز أقل ثقة من حساب User) */
export async function employeePortalProfile(employeeId: string, tenantId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { id: true, name: true, jobTitle: true, department: true, companyId: true },
  });
  if (!employee) throw unauthorized("الحساب غير موجود");
  const directReportsCount = await prisma.employee.count({ where: { managerId: employeeId, tenantId } });
  return { ...employee, isManager: directReportsCount > 0 };
}
