import { RequestHandler } from "express";
import * as service from "./employeeAdvances.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope, assertCompanyAccess } from "../../middleware/auth";
import { badRequest } from "../../lib/httpError";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, employeeId } = req.query;
  res.json(
    await service.listEmployeeAdvances(req.auth!.tenantId, {
      companyId: typeof companyId === "string" ? companyId : undefined,
      employeeId: typeof employeeId === "string" ? employeeId : undefined,
    }),
  );
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createEmployeeAdvance(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const setInstallmentHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.employeeAdvance, req.params.id);
  res.json(await service.setAdvanceInstallment(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.monthlyInstallment));
};

export const reclassPreviewHandler: RequestHandler = async (req, res) => {
  const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
  if (!companyId) throw badRequest("companyId مطلوب");
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.previewAdvancesReclass(req.auth!.tenantId, companyId));
};

export const removeHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.employeeAdvance, req.params.id);
  await service.removeEmployeeAdvance(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin);
  res.status(204).send();
};
