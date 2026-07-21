import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId?: string | null) {
  if (!companyId) return;
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listCostCenters: RequestHandler = async (req, res) => {
  const costCenters = await prisma.costCenter.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "asc" },
  });
  res.json(costCenters);
};

export const createCostCenter: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const costCenter = await prisma.costCenter.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(costCenter);
};

export const updateCostCenter: RequestHandler = async (req, res) => {
  const existing = await prisma.costCenter.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("مركز التكلفة غير موجود");
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const costCenter = await prisma.costCenter.update({ where: { id: existing.id }, data: req.body });
  res.json(costCenter);
};

export const deleteCostCenter: RequestHandler = async (req, res) => {
  const existing = await prisma.costCenter.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("مركز التكلفة غير موجود");

  await prisma.costCenter.delete({ where: { id: existing.id } });
  res.status(204).send();
};
