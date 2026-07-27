import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listLeaseContracts: RequestHandler = async (req, res) => {
  const companyId = req.query.companyId as string | undefined;
  const leaseContracts = await prisma.leaseContract.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: companyId || undefined },
    orderBy: { endDate: "asc" },
  });
  res.json(leaseContracts);
};

export const createLeaseContract: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const leaseContract = await prisma.leaseContract.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(leaseContract);
};

export const updateLeaseContract: RequestHandler = async (req, res) => {
  const existing = await prisma.leaseContract.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("عقد الإيجار غير موجود");
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const leaseContract = await prisma.leaseContract.update({ where: { id: existing.id }, data: req.body });
  res.json(leaseContract);
};

export const deleteLeaseContract: RequestHandler = async (req, res) => {
  const existing = await prisma.leaseContract.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("عقد الإيجار غير موجود");

  await prisma.leaseContract.delete({ where: { id: existing.id } });
  res.status(204).send();
};
