import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listCompanyDocuments: RequestHandler = async (req, res) => {
  const companyId = req.query.companyId as string | undefined;
  const companyDocuments = await prisma.companyDocument.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: companyId || undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(companyDocuments);
};

export const createCompanyDocument: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const companyDocument = await prisma.companyDocument.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(companyDocument);
};

export const updateCompanyDocument: RequestHandler = async (req, res) => {
  const existing = await prisma.companyDocument.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("المستند غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const companyDocument = await prisma.companyDocument.update({ where: { id: existing.id }, data: req.body });
  res.json(companyDocument);
};

export const deleteCompanyDocument: RequestHandler = async (req, res) => {
  const existing = await prisma.companyDocument.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("المستند غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);

  await prisma.companyDocument.delete({ where: { id: existing.id } });
  res.status(204).send();
};
