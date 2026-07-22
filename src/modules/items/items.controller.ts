import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listItems: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const items = await prisma.item.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(items);
};

export const createItem: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const item = await prisma.item.create({ data: { ...req.body, tenantId: req.auth!.tenantId } });
  res.status(201).json(item);
};

export const updateItem: RequestHandler = async (req, res) => {
  const existing = await prisma.item.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الصنف غير موجود");
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const item = await prisma.item.update({ where: { id: existing.id }, data: req.body });
  res.json(item);
};

export const deleteItem: RequestHandler = async (req, res) => {
  const existing = await prisma.item.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الصنف غير موجود");
  await prisma.item.delete({ where: { id: existing.id } });
  res.status(204).send();
};
