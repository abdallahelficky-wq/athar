import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

/**
 * حساب مخزون المستودع: من نفس المستأجر والشركة، حساب أصول ترحيل نشط غير مؤرشف — نفس شروط createJournalEntryTx عند
 * الترحيل، فرفضه هنا يمنع إعداداً يُفشل كل حركة لاحقة على المستودع.
 */
async function assertWarehouseStockAccount(tenantId: string, companyId: string, accountId: string | null | undefined) {
  if (!accountId) return;
  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId, companyId, type: "asset", isPosting: true, isActive: true, isArchived: false },
    select: { id: true },
  });
  if (!account) throw badRequest("حساب مخزون المستودع يجب أن يكون حساب أصول ترحيل نشطاً غير مؤرشف من نفس الشركة");
}

/** للمستودع حركات مخزون أو أسطر شراء؟ — يمنع حذفه، ويمنع تغيير حساب مخزونه (رصيده القائم مسجَّل على الحساب القديم). */
async function warehouseHasActivity(warehouseId: string) {
  const [movements, purchaseLines] = await Promise.all([
    prisma.stockMovement.count({ where: { warehouseId } }),
    prisma.purchaseInvoiceLine.count({ where: { warehouseId } }),
  ]);
  return movements + purchaseLines > 0;
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
  assertCompanyAccess(req.auth!, req.body.companyId);
  await assertWarehouseStockAccount(tenantId, req.body.companyId, req.body.stockAccountId);

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
  assertCompanyAccess(req.auth!, existing.companyId);
  if (req.body.stockAccountId !== undefined && (req.body.stockAccountId ?? null) !== existing.stockAccountId) {
    await assertWarehouseStockAccount(tenantId, existing.companyId, req.body.stockAccountId);
    if (await warehouseHasActivity(existing.id)) {
      throw badRequest("لا يمكن تغيير حساب مخزون مستودع له حركات مخزون مسجّلة — رصيده القائم مرحَّل على الحساب الحالي");
    }
  }

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
  assertCompanyAccess(req.auth!, existing.companyId);

  if (await warehouseHasActivity(existing.id)) throw badRequest("لا يمكن حذف مستودع له حركات مخزون مسجّلة؛ استخدم الأرشفة بدلاً من ذلك");

  await prisma.warehouse.delete({ where: { id: existing.id } });
  res.status(204).send();
};
