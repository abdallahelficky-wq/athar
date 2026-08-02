import { prisma } from "../../lib/prisma";
import { badRequest, notFound, forbidden } from "../../lib/httpError";
import { accruedLeaveDays } from "../../lib/hrCalculations";

function daysBetween(start: Date, end: Date) {
  return Math.max(Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1, 0);
}

export interface LeaveRequestInput {
  type: string;
  startDate: Date;
  endDate: Date;
  note?: string;
}

/** إنشاء طلب إجازة — يبدأ دائماً بحالة "قيد المراجعة" (pending)، سواء أنشأه الموظف نفسه من البوابة أو أنشأته الموارد البشرية نيابةً عنه */
export async function createLeaveRequestFor(tenantId: string, employeeId: string, input: LeaveRequestInput) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!employee) throw badRequest("الموظف غير موجود ضمن مستأجرك");

  return prisma.leaveRequest.create({
    data: {
      employeeId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      days: daysBetween(input.startDate, input.endDate),
      note: input.note,
      status: "pending",
    },
    include: { employee: true },
  });
}

export async function listOwnLeaveRequests(tenantId: string, employeeId: string) {
  return prisma.leaveRequest.findMany({
    where: { employeeId, employee: { tenantId } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * رصيد الإجازة السنوية التقريبي: التراكم منذ آخر عودة من إجازة (accruedLeaveDays) ناقص أيام
 * الطلبات المعتمدة منذ نفس تاريخ المرجع — تقدير تقريبي وليس دفتر أرصدة رسمياً مفصّلاً لكل نوع
 * إجازة (لا يوجد نظام أرصدة رسمي بعد في المنشأة)، مطابق لمنطق accruedLeaveDays الحالي فقط.
 */
export async function leaveBalance(tenantId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!employee) throw notFound("الموظف غير موجود");

  const accrual = accruedLeaveDays({ hireDate: employee.hireDate, lastLeaveReturnDate: employee.lastLeaveReturnDate }, new Date());
  const usedSinceAnchor = await prisma.leaveRequest.aggregate({
    _sum: { days: true },
    where: { employeeId, status: "approved", startDate: { gte: accrual.refDate } },
  });
  const usedDays = usedSinceAnchor._sum.days ?? 0;
  return {
    annualEntitlement: accrual.annualEntitlement,
    accruedDays: accrual.days,
    usedDays,
    remainingDays: accrual.days - usedDays,
  };
}

/** طلبات الإجازة المعلّقة لموظفين يتبعون هذا المدير المباشر تحديداً */
export async function managerInbox(tenantId: string, managerEmployeeId: string) {
  return prisma.leaveRequest.findMany({
    where: { status: "pending", employee: { tenantId, managerId: managerEmployeeId } },
    include: { employee: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * منطق الموافقة/الرفض المشترك بين بوابة المدير المباشر والواجهة الإدارية (HR/admin) — قاعدة
 * واحدة في مكان واحد: المدير المباشر المعيَّن فعلياً على الموظف هو الوحيد المخوَّل من جهة
 * البوابة، بينما تتجاوز الواجهة الإدارية هذا الشرط دائماً (isHrOverride).
 */
export async function transitionLeaveRequest(
  tenantId: string,
  requestId: string,
  action: "approved" | "rejected",
  approver: { approverEmployeeId: string | null; isHrOverride: boolean },
) {
  const request = await prisma.leaveRequest.findFirst({
    where: { id: requestId, employee: { tenantId } },
    include: { employee: true },
  });
  if (!request) throw notFound("طلب الإجازة غير موجود");
  if (request.status !== "pending") throw badRequest("تمت معالجة هذا الطلب مسبقاً");
  if (!approver.isHrOverride && request.employee.managerId !== approver.approverEmployeeId) {
    throw forbidden("لست المدير المباشر لهذا الموظف");
  }

  return prisma.leaveRequest.update({ where: { id: requestId }, data: { status: action }, include: { employee: true } });
}
