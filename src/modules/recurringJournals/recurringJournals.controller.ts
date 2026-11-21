import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./recurringJournals.service";

/** قالب بمعرّفه: محصور في مستأجر الطلب (الخدمة) وفي نطاق شركة المستخدم (هنا) */
async function inScope(req: Parameters<RequestHandler>[0]) {
  const t = await prisma.recurringJournalTemplate.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (t) assertCompanyAccess(req.auth!, t.companyId);
}

export const listHandler: RequestHandler = async (req, res) => {
  const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.listTemplates(req.auth!.tenantId, companyId));
};

export const getHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  res.json(await service.getTemplate(req.auth!.tenantId, req.params.id));
};

export const createHandler: RequestHandler = async (req, res) => {
  assertCompanyAccess(req.auth!, req.body.companyId);
  res.status(201).json(await service.createTemplate(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const updateHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  assertCompanyAccess(req.auth!, req.body.companyId);
  res.json(await service.updateTemplate(req.auth!.tenantId, req.params.id, req.body));
};

export const activeHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  res.json(await service.setActive(req.auth!.tenantId, req.params.id, req.body.active));
};

export const runNowHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  res.json(await service.runTemplateNow(req.auth!.tenantId, req.params.id));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  await service.deleteTemplate(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
