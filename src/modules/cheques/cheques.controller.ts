import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./cheques.service";

const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

async function inScope(req: Parameters<RequestHandler>[0]) {
  const c = await prisma.cheque.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (c) assertCompanyAccess(req.auth!, c.companyId);
}

function companyOf(req: Parameters<RequestHandler>[0]) {
  const companyId = q(req.query.companyId) ?? q(req.body?.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

export const listHandler: RequestHandler = async (req, res) => {
  const companyId = companyOf(req);
  const direction = q(req.query.direction);
  const status = q(req.query.status);
  res.json(await service.listCheques(req.auth!.tenantId, companyId, {
    direction: direction === "received" || direction === "issued" ? direction : undefined,
    status: status && ["pending", "cleared", "bounced", "cancelled"].includes(status) ? (status as never) : undefined,
    dueTo: q(req.query.dueTo),
  }));
};

export const getHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  res.json(await service.getCheque(req.auth!.tenantId, req.params.id));
};

export const createHandler: RequestHandler = async (req, res) => {
  companyOf(req);
  res.status(201).json(await service.createCheque(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const actionHandler = (action: "clear" | "bounce" | "cancel"): RequestHandler => async (req, res) => {
  await inScope(req);
  res.json(await service.applyChequeAction(req.auth!.tenantId, req.auth!.sub, req.params.id, action, req.body));
};

export const undoHandler: RequestHandler = async (req, res) => {
  await inScope(req);
  const result = await service.undoLastEvent(req.auth!.tenantId, req.params.id);
  if (!result) res.status(204).send();
  else res.json(result);
};

export const getSettingsHandler: RequestHandler = async (req, res) => {
  res.json(await service.getChequeSettings(req.auth!.tenantId, companyOf(req)));
};

export const settingsHandler: RequestHandler = async (req, res) => {
  const companyId = companyOf(req);
  const { companyId: _c, ...input } = req.body;
  res.json(await service.updateChequeSettings(req.auth!.tenantId, companyId, input));
};
