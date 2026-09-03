import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { ensurePartyAccount, resolvePartyAccountId } from "../../lib/partyAccounts";
import { assertCompanyAccess } from "../../middleware/auth";

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
  assertCompanyAccess(req.auth!, supplier.companyId);
  const accountId = await resolvePartyAccountId(req.auth!.tenantId, supplier.companyId, supplier, "ذمم دائنة - موردين");

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      supplierId: supplier.id,
      accountId,
      journalEntry: { tenantId: req.auth!.tenantId },
    },
    select: { debit: true, credit: true },
  });
  const balance = lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
  res.json({ balance });
};

/** إنشاء مورد جديد مع حساب تفصيلي مستقل تلقائي تحت "الذمم الدائنة التجارية" (partyAccounts.ts) */
export const createSupplier: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const supplier = await prisma.$transaction(async (tx) => {
    const { accountId } = await ensurePartyAccount(tx, {
      tenantId: req.auth!.tenantId, companyId: req.body.companyId, kind: "supplier", partyName: req.body.name,
    });
    return tx.supplier.create({ data: { ...req.body, tenantId: req.auth!.tenantId, accountId } });
  });
  res.status(201).json(supplier);
};

export const updateSupplier: RequestHandler = async (req, res) => {
  const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("المورد غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const supplier = await prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({ where: { id: existing.id }, data: req.body });
    if (updated.accountId && req.body.name && req.body.name !== existing.name) {
      await tx.account.update({ where: { id: updated.accountId }, data: { name: req.body.name } });
    }
    return updated;
  });
  res.json(supplier);
};

export const deleteSupplier: RequestHandler = async (req, res) => {
  const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("المورد غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);

  const [purchaseInvoices, purchaseReturns, journalLines] = await Promise.all([
    prisma.purchaseInvoice.count({ where: { supplierId: existing.id } }),
    prisma.purchaseReturn.count({ where: { supplierId: existing.id } }),
    prisma.journalEntryLine.count({ where: { supplierId: existing.id } }),
  ]);
  if (purchaseInvoices || purchaseReturns || journalLines) {
    const reasons = [
      purchaseInvoices ? `${purchaseInvoices} فاتورة مشتريات` : "",
      purchaseReturns ? `${purchaseReturns} مردود مشتريات` : "",
      journalLines ? `${journalLines} حركة في القيود` : "",
    ].filter(Boolean).join("، ");
    throw badRequest(`لا يمكن حذف هذا المورد لارتباطه بـ ${reasons}. عدّل بيانات المورد بدلاً من حذفه إن لزم الأمر.`);
  }

  await prisma.supplier.delete({ where: { id: existing.id } });
  res.status(204).send();
};
