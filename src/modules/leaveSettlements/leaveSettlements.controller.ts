import { RequestHandler } from "express";
import * as service from "./leaveSettlements.service";
import { badRequest } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope, assertCompanyAccess } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, employeeId } = req.query;
  res.json(await service.listLeaveSettlements(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    employeeId: typeof employeeId === "string" ? employeeId : undefined,
  }));
};

export const previewHandler: RequestHandler = async (req, res) => {
  const { employeeId, leaveStartDate, leaveEndDate, settlementType, cashLeaveDays } = req.query;
  if (typeof employeeId !== "string" || typeof leaveStartDate !== "string") throw badRequest("employeeId و leaveStartDate مطلوبان");
  await assertRecordCompanyScope(req.auth!, prisma.employee, employeeId);
  res.json(await service.previewLeaveSettlement(req.auth!.tenantId, employeeId, new Date(leaveStartDate), {
    leaveEndDate: typeof leaveEndDate === "string" && leaveEndDate ? new Date(leaveEndDate) : null,
    settlementType: settlementType === "cash_in_service" ? "cash_in_service" : "actual_leave",
    cashLeaveDays: typeof cashLeaveDays === "string" ? Number(cashLeaveDays) : 0,
  }));
};

export const createHandler: RequestHandler = async (req, res) => {
  if (req.body?.employeeId) await assertRecordCompanyScope(req.auth!, prisma.employee, req.body.employeeId);
  res.status(201).json(await service.createLeaveSettlement(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const disburseHandler: RequestHandler = async (req, res) => {
  const existing = await prisma.leaveSettlement.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { employee: { select: { companyId: true } } },
  });
  if (existing) assertCompanyAccess(req.auth!, existing.employee.companyId);
  res.json(await service.disburseLeaveSettlement(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.method, req.body.date));
};
