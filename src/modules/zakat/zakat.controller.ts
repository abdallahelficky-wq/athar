import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./zakat.service";
import { computeSchema } from "./zakat.schemas";

async function declarationInScope(req: Parameters<RequestHandler>[0]) {
  const d = await prisma.zakatDeclaration.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (d) assertCompanyAccess(req.auth!, d.companyId);
}

export const computeHandler: RequestHandler = async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  let adjustments: unknown = [];
  try {
    adjustments = q.adjustments ? JSON.parse(q.adjustments) : [];
  } catch {
    throw badRequest("تسويات صافي الربح غير صالحة");
  }
  const parsed = computeSchema.safeParse({
    companyId: q.companyId,
    periodStart: q.periodStart,
    periodEnd: q.periodEnd,
    hijriYear: q.hijriYear === "true",
    ...(q.method ? { method: q.method } : {}),
    ...(q.zakatableOwnershipPct ? { zakatableOwnershipPct: q.zakatableOwnershipPct } : {}),
    adjustments,
  });
  if (!parsed.success) throw badRequest("بيانات غير صالحة", parsed.error.flatten());
  const { companyId, ...opts } = parsed.data;
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.computeCompanyZakat(req.auth!.tenantId, companyId, opts));
};

export const settingsHandler: RequestHandler = async (req, res) => {
  assertCompanyAccess(req.auth!, req.body.companyId);
  const { companyId, ...settings } = req.body;
  res.json(await service.updateZakatSettings(req.auth!.tenantId, companyId, settings));
};

export const treatmentHandler: RequestHandler = async (req, res) => {
  const account = await prisma.account.findFirst({ where: { id: req.params.accountId, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (account?.companyId) assertCompanyAccess(req.auth!, account.companyId);
  res.json(await service.setAccountTreatment(req.auth!.tenantId, req.params.accountId, req.body.treatment));
};

export const listHandler: RequestHandler = async (req, res) => {
  const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.listDeclarations(req.auth!.tenantId, companyId));
};

export const saveHandler: RequestHandler = async (req, res) => {
  assertCompanyAccess(req.auth!, req.body.companyId);
  const { companyId, ...opts } = req.body;
  res.status(201).json(await service.saveDeclaration(req.auth!.tenantId, req.auth!.sub, companyId, opts));
};

export const getHandler: RequestHandler = async (req, res) => {
  await declarationInScope(req);
  res.json(await service.getDeclaration(req.auth!.tenantId, req.params.id));
};

export const postHandler: RequestHandler = async (req, res) => {
  await declarationInScope(req);
  res.json(await service.postDeclaration(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await declarationInScope(req);
  await service.deleteDeclaration(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
