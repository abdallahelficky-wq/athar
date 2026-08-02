import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

/** يُطبِّع أي لحظة زمنية إلى بداية يومها التقويمي (UTC) — مفتاح "سجل واحد لكل يوم" */
function dayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

async function assertEmployeePortalActive(tenantId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId, status: "active" } });
  if (!employee) throw notFound("الموظف غير موجود");
  return employee;
}

/** تسجيل حضور — عملية idempotent: نداء ثانٍ في نفس اليوم لا يُغيّر وقت الحضور الأصلي */
export async function checkIn(tenantId: string, employeeId: string, at: Date) {
  const employee = await assertEmployeePortalActive(tenantId, employeeId);
  const date = dayStart(at);
  const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (existing?.checkInAt) return existing;

  return prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { tenantId, companyId: employee.companyId, employeeId, date, checkInAt: at },
    update: { checkInAt: at },
  });
}

/** تسجيل انصراف — يتطلب وجود تسجيل حضور لنفس اليوم أولاً */
export async function checkOut(tenantId: string, employeeId: string, at: Date) {
  await assertEmployeePortalActive(tenantId, employeeId);
  const date = dayStart(at);
  const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (!existing || !existing.checkInAt) throw badRequest("لا يوجد تسجيل حضور لهذا اليوم بعد");

  return prisma.attendanceRecord.update({ where: { id: existing.id }, data: { checkOutAt: at } });
}

export async function myHistory(tenantId: string, employeeId: string, days = 60) {
  await assertEmployeePortalActive(tenantId, employeeId);
  const since = dayStart(new Date(Date.now() - days * 86_400_000));
  return prisma.attendanceRecord.findMany({
    where: { tenantId, employeeId, date: { gte: since } },
    orderBy: { date: "desc" },
  });
}

/** كل موظفي الشركة النشطين (المفعّل لهم دخول بوابة) مع سجل حضورهم ليوم معيّن (إن وُجد) */
export async function companyDaily(tenantId: string, companyId: string, date: Date) {
  const day = dayStart(date);
  const employees = await prisma.employee.findMany({
    where: { tenantId, companyId, status: "active", portalActive: true },
    select: { id: true, name: true, jobTitle: true, department: true },
    orderBy: { name: "asc" },
  });
  const records = await prisma.attendanceRecord.findMany({ where: { tenantId, companyId, date: day } });
  const byEmployeeId = new Map(records.map((r) => [r.employeeId, r]));
  return employees.map((employee) => ({ employee, record: byEmployeeId.get(employee.id) ?? null }));
}

/** غياب تام فقط (لا يوجد أي سجل حضور اليوم) مع استبعاد من هو في إجازة معتمدة تغطي اليوم — بلا أي منطق تأخير/انصراف مبكر (مؤجَّل) */
export async function absentToday(tenantId: string, companyId: string, date: Date) {
  const day = dayStart(date);
  const rows = await companyDaily(tenantId, companyId, day);
  const missing = rows.filter((r) => !r.record);
  if (missing.length === 0) return [];

  const onApprovedLeave = await prisma.leaveRequest.findMany({
    where: {
      status: "approved",
      startDate: { lte: day },
      endDate: { gte: day },
      employeeId: { in: missing.map((r) => r.employee.id) },
    },
    select: { employeeId: true },
  });
  const onLeaveIds = new Set(onApprovedLeave.map((r) => r.employeeId));
  return missing.filter((r) => !onLeaveIds.has(r.employee.id)).map((r) => r.employee);
}
