import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const sales = await prisma.stationSale.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    include: { costCenter: true },
    orderBy: { date: "desc" },
  });
  res.json(sales);
};

export const createHandler: RequestHandler = async (req, res) => {
  const { companyId, costCenterId } = req.body;
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId: req.auth!.tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const costCenter = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId: req.auth!.tenantId } });
  if (!costCenter) throw badRequest("المحطة (مركز التكلفة) غير موجودة");

  const sale = await prisma.stationSale.create({ data: { ...req.body, tenantId: req.auth!.tenantId } });
  res.status(201).json(sale);
};

export const deleteHandler: RequestHandler = async (req, res) => {
  const existing = await prisma.stationSale.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("سجل المبيعات غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);
  await prisma.stationSale.delete({ where: { id: existing.id } });
  res.status(204).send();
};
