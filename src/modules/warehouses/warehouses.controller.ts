import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listWarehouses: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(warehouses);
};

export const createWarehouse: RequestHandler = async (req, res) => {
  const tenantId = req.auth!.tenantId;
  await assertCompanyBelongsToTenant(tenantId, req.body.companyId);

  const warehouse = await prisma.$transaction(async (tx) => {
    if (req.body.isDefault) {
      await tx.warehouse.updateMany({ where: { tenantId, companyId: req.body.companyId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.warehouse.create({ data: { ...req.body, tenantId } });
  });
  res.status(201).json(warehouse);
};

export const updateWarehouse: RequestHandler = async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.warehouse.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) throw notFound("المستودع غير موجود");

  const warehouse = await prisma.$transaction(async (tx) => {
    if (req.body.isDefault) {
      await tx.warehouse.updateMany({
        where: { tenantId, companyId: existing.companyId, isDefault: true, id: { not: existing.id } },
        data: { isDefault: false },
      });
    }
    return tx.warehouse.update({ where: { id: existing.id }, data: req.body });
  });
  res.json(warehouse);
};

export const deleteWarehouse: RequestHandler = async (req, res) => {
  const existing = await prisma.warehouse.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("المستودع غير موجود");

  const [movements, purchaseLines] = await Promise.all([
    prisma.stockMovement.count({ where: { warehouseId: existing.id } }),
    prisma.purchaseInvoiceLine.count({ where: { warehouseId: existing.id } }),
  ]);
  if (movements || purchaseLines) throw badRequest("لا يمكن حذف مستودع له حركات مخزون مسجّلة؛ استخدم الأرشفة بدلاً من ذلك");

  await prisma.warehouse.delete({ where: { id: existing.id } });
  res.status(204).send();
};
