import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import * as service from "./bankReconciliation.service";

const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

/** كشف بمعرّفه: محصور في مستأجر الطلب (الخدمة) وفي نطاق شركة المستخدم (هنا) */
async function statementInScope(req: Parameters<RequestHandler>[0]) {
  const statement = await prisma.bankStatement.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (statement) assertCompanyAccess(req.auth!, statement.companyId);
}

export const listHandler: RequestHandler = async (req, res) => {
  const companyId = q(req.query.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.listStatements(req.auth!.tenantId, companyId, q(req.query.accountId)));
};

export const createHandler: RequestHandler = async (req, res) => {
  assertCompanyAccess(req.auth!, req.body.companyId);
  res.status(201).json(await service.createStatement(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const getHandler: RequestHandler = async (req, res) => {
  await statementInScope(req);
  res.json(await service.getStatement(req.auth!.tenantId, req.params.id));
};

export const autoMatchHandler: RequestHandler = async (req, res) => {
  await statementInScope(req);
  const result = await service.autoMatch(req.auth!.tenantId, req.auth!.sub, req.params.id);
  res.json({ ...result, statement: await service.getStatement(req.auth!.tenantId, req.params.id) });
};

export const matchHandler: RequestHandler = async (req, res) => {
  await statementInScope(req);
  await service.matchLine(req.auth!.tenantId, req.auth!.sub, req.params.id, req.params.lineId, req.body.journalEntryLineId);
  res.json(await service.getStatement(req.auth!.tenantId, req.params.id));
};

export const unmatchHandler: RequestHandler = async (req, res) => {
  await statementInScope(req);
  await service.unmatchLine(req.auth!.tenantId, req.params.id, req.params.lineId);
  res.json(await service.getStatement(req.auth!.tenantId, req.params.id));
};

export const reconcileHandler: RequestHandler = async (req, res) => {
  await statementInScope(req);
  await service.reconcileStatement(req.auth!.tenantId, req.auth!.sub, req.params.id);
  res.json(await service.getStatement(req.auth!.tenantId, req.params.id));
};

export const reopenHandler: RequestHandler = async (req, res) => {
  await statementInScope(req);
  await service.reopenStatement(req.auth!.tenantId, req.params.id);
  res.json(await service.getStatement(req.auth!.tenantId, req.params.id));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await statementInScope(req);
  await service.deleteStatement(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
