import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";

async function assertCompanyBelongsToTenant(tenantId: string, companyId?: string | null) {
  if (!companyId) return;
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listDepartments: RequestHandler = async (req, res) => {
  const { companyScope } = req.auth!;
  const departments = await prisma.department.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(companyScope === "all" ? {} : { OR: [{ companyId: null }, { companyId: companyScope }] }),
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(departments);
};

export const createDepartment: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const department = await prisma.department.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(department);
};

export const updateDepartment: RequestHandler = async (req, res) => {
  const existing = await prisma.department.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("القسم غير موجود");
  if (existing.companyId) assertCompanyAccess(req.auth!, existing.companyId);
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const department = await prisma.department.update({ where: { id: existing.id }, data: req.body });
  res.json(department);
};

export const deleteDepartment: RequestHandler = async (req, res) => {
  const existing = await prisma.department.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("القسم غير موجود");
  if (existing.companyId) assertCompanyAccess(req.auth!, existing.companyId);

  await prisma.department.delete({ where: { id: existing.id } });
  res.status(204).send();
};
