import { RequestHandler } from "express";
import * as service from "./payrollRuns.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, month } = req.query;
  res.json(await service.listPayrollRuns(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    month: typeof month === "string" ? month : undefined,
  }));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createPayrollRun(req.auth!.tenantId, req.body.companyId, req.body.month, req.body.employeeIds));
};

export const rowsHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.payrollRun, req.params.id);
  res.json(await service.getPayrollRunRows(req.auth!.tenantId, req.params.id));
};

export const updateEmployeesHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.payrollRun, req.params.id);
  res.json(await service.updatePayrollRunEmployees(req.auth!.tenantId, req.params.id, req.body.employeeIds));
};

export const setOverrideHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.payrollRun, req.params.id);
  res.json(await service.setRowOverride(req.auth!.tenantId, req.params.id, req.params.employeeId, req.body));
};

export const clearOverrideHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.payrollRun, req.params.id);
  res.json(await service.clearRowOverride(req.auth!.tenantId, req.params.id, req.params.employeeId));
};

export const postHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.payrollRun, req.params.id);
  res.json(await service.postPayrollRun(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.payrollRun, req.params.id);
  res.json(await service.unpostPayrollRun(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};
