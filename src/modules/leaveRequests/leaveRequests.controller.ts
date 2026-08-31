import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";
import * as service from "./leaveRequests.service";

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

/** الموارد البشرية تُسجِّل طلباً نيابةً عن موظف — يبدأ "قيد المراجعة" كأي طلب آخر، ويحتاج نفس مسار الموافقة */
export const createLeaveRequest: RequestHandler = async (req, res) => {
  const request = await service.createLeaveRequestFor(req.auth!.tenantId, req.body.employeeId, req.body);
  res.status(201).json(request);
};

export const updateLeaveRequestHandler: RequestHandler = async (req, res) => {
  const request = await service.updateLeaveRequest(req.auth!.tenantId, req.params.id, req.body);
  res.json(request);
};

export const approveLeaveRequestHandler: RequestHandler = async (req, res) => {
  const request = await service.transitionLeaveRequest(req.auth!.tenantId, req.params.id, "approved", {
    approverEmployeeId: null,
    isHrOverride: true,
  });
  res.json(request);
};

export const rejectLeaveRequestHandler: RequestHandler = async (req, res) => {
  const request = await service.transitionLeaveRequest(req.auth!.tenantId, req.params.id, "rejected", {
    approverEmployeeId: null,
    isHrOverride: true,
  });
  res.json(request);
};

export const deleteLeaveRequest: RequestHandler = async (req, res) => {
  const existing = await prisma.leaveRequest.findFirst({
    where: { id: req.params.id, employee: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) throw notFound("طلب الإجازة غير موجود");
  await prisma.leaveRequest.delete({ where: { id: existing.id } });
  res.status(204).send();
};
