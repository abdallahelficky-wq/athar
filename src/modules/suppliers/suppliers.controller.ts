import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listSuppliers: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const suppliers = await prisma.supplier.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(suppliers);
};

export const getSupplierBalance: RequestHandler = async (req, res) => {
  const supplier = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!supplier) throw notFound("المورد غير موجود");

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      supplierId: supplier.id,
      account: { name: "ذمم دائنة - موردين" },
      journalEntry: { status: "posted", tenantId: req.auth!.tenantId },
    },
    select: { debit: true, credit: true },
  });
  const balance = lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
  res.json({ balance });
};

export const createSupplier: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const supplier = await prisma.supplier.create({ data: { ...req.body, tenantId: req.auth!.tenantId } });
  res.status(201).json(supplier);
};

export const updateSupplier: RequestHandler = async (req, res) => {
  const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("المورد غير موجود");
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const supplier = await prisma.supplier.update({ where: { id: existing.id }, data: req.body });
  res.json(supplier);
};

export const deleteSupplier: RequestHandler = async (req, res) => {
  const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("المورد غير موجود");
  await prisma.supplier.delete({ where: { id: existing.id } });
  res.status(204).send();
};
