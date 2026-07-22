import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

function daysBetween(start: Date, end: Date) {
  return Math.max(Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1, 0);
}

export const listLeaveRequests: RequestHandler = async (req, res) => {
  const { employeeId, companyId } = req.query;
  const requests = await prisma.leaveRequest.findMany({
    where: {
      employeeId: typeof employeeId === "string" ? employeeId : undefined,
      employee: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(requests);
};

export const createLeaveRequest: RequestHandler = async (req, res) => {
  const employee = await prisma.employee.findFirst({ where: { id: req.body.employeeId, tenantId: req.auth!.tenantId } });
  if (!employee) throw badRequest("الموظف غير موجود ضمن مستأجرك");

  const request = await prisma.leaveRequest.create({
    data: {
      employeeId: req.body.employeeId,
      type: req.body.type,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      days: daysBetween(req.body.startDate, req.body.endDate),
      note: req.body.note,
      status: "approved",
    },
    include: { employee: true },
  });
  res.status(201).json(request);
};

export const deleteLeaveRequest: RequestHandler = async (req, res) => {
  const existing = await prisma.leaveRequest.findFirst({
    where: { id: req.params.id, employee: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) throw notFound("طلب الإجازة غير موجود");
  await prisma.leaveRequest.delete({ where: { id: existing.id } });
  res.status(204).send();
};
