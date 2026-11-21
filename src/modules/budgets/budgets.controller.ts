import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./budgets.service";

const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

async function inScope(req: Parameters<RequestHandler>[0]) {
  const b = await prisma.budget.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (b) assertCompanyAccess(req.auth!, b.companyId);
}

function companyOf(req: Parameters<RequestHandler>[0]) {
  const companyId = q(req.query.companyId) ?? q(req.body?.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

export const listHandler: RequestHandler = async (req, res) => {
  res.json(await service.listBudgets(req.auth!.tenantId, companyOf(req)));
};
export const getHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  res.json(await service.getBudget(req.auth!.tenantId, req.params.id));
};
export const createHandler: RequestHandler = async (req, res) => {
  companyOf(req);
  res.status(201).json(await service.createBudget(req.auth!.tenantId, req.auth!.sub, req.body));
};
export const updateHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  companyOf(req);
  res.json(await service.updateBudget(req.auth!.tenantId, req.params.id, req.body));
};
export const statusHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  res.json(await service.setBudgetStatus(req.auth!.tenantId, req.params.id, req.body.status));
};
export const deleteHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  await service.deleteBudget(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
export const reportHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  const through = q(req.query.through) ? Number(req.query.through) : undefined;
  res.json(await service.budgetVsActual(req.auth!.tenantId, req.params.id, Number.isFinite(through) ? through : undefined));
};
export const suggestHandler: RequestHandler = async (req, res) => {
  const companyId = companyOf(req);
  const source = q(req.query.sourceStartMonth);
  if (!source || !/^\d{4}-\d{2}$/.test(source)) throw badRequest("شهر بداية الموازنة غير صالح");
  res.json(await service.suggestFromActuals(req.auth!.tenantId, companyId, source, Number(req.query.growthPct || 0), q(req.query.costCenterId) ?? null));
};
