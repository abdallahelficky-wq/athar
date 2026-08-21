import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listBranches: RequestHandler = async (req, res) => {
  const companyId = req.query.companyId as string | undefined;
  const branches = await prisma.branch.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: companyId || undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(branches);
};

export const createBranch: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const branch = await prisma.branch.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(branch);
};

export const updateBranch: RequestHandler = async (req, res) => {
  const existing = await prisma.branch.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الفرع غير موجود");
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const branch = await prisma.branch.update({ where: { id: existing.id }, data: req.body });
  res.json(branch);
};

/**
 * حذف نهائي — يُرفَض لو الفرع مرتبط بأي قيد يومية أو فاتورة مبيعات/مشتريات سابقة، حتى لا تُفقَد
 * إمكانية تتبّع تلك المستندات لفرعها لاحقاً؛ الخيار الصحيح لفرع لم يعد نشِطاً هو تعطيله
 * (PATCH isActive:false) لا حذفه، تماماً كما هو مطلوب صراحة — بخلاف الحذف الحر لـ CostCenter/
 * Department المعتمِد فقط على onDelete: SetNull.
 */
export const deleteBranch: RequestHandler = async (req, res) => {
  const existing = await prisma.branch.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الفرع غير موجود");

  const [lineCount, salesCount, purchaseCount] = await Promise.all([
    prisma.journalEntryLine.count({ where: { branchId: existing.id } }),
    prisma.salesInvoice.count({ where: { branchId: existing.id } }),
    prisma.purchaseInvoice.count({ where: { branchId: existing.id } }),
  ]);
  if (lineCount > 0 || salesCount > 0 || purchaseCount > 0) {
    throw badRequest("لا يمكن حذف هذا الفرع نهائياً لارتباطه بقيود أو فواتير سابقة — عطّله بدلاً من ذلك");
  }

  await prisma.branch.delete({ where: { id: existing.id } });
  res.status(204).send();
};
