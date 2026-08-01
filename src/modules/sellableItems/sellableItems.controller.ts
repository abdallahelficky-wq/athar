import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertRefs(tenantId: string, companyId: string, revenueAccountId?: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  if (revenueAccountId) {
    const account = await prisma.account.findFirst({
      where: { id: revenueAccountId, tenantId, companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
    });
    if (!account) throw badRequest("الحساب المرتبط يجب أن يكون حساب إيراد صالحاً من شجرة هذه الشركة");
  }
}

export const listSellableItems: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const items = await prisma.sellableItem.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    include: { defaultRevenueAccount: true },
    orderBy: { name: "asc" },
  });
  res.json(items);
};

export const createSellableItem: RequestHandler = async (req, res) => {
  await assertRefs(req.auth!.tenantId, req.body.companyId, req.body.defaultRevenueAccountId);
  const item = await prisma.sellableItem.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
    include: { defaultRevenueAccount: true },
  });
  res.status(201).json(item);
};

export const updateSellableItem: RequestHandler = async (req, res) => {
  const existing = await prisma.sellableItem.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الصنف غير موجود");
  if (req.body.companyId || req.body.defaultRevenueAccountId) {
    await assertRefs(req.auth!.tenantId, req.body.companyId || existing.companyId, req.body.defaultRevenueAccountId);
  }
  const item = await prisma.sellableItem.update({
    where: { id: existing.id },
    data: req.body,
    include: { defaultRevenueAccount: true },
  });
  res.json(item);
};

export const deleteSellableItem: RequestHandler = async (req, res) => {
  const existing = await prisma.sellableItem.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الصنف غير موجود");
  await prisma.sellableItem.delete({ where: { id: existing.id } });
  res.status(204).send();
};
