import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listCompanyBankAccounts: RequestHandler = async (req, res) => {
  const companyId = req.query.companyId as string | undefined;
  const accounts = await prisma.companyBankAccount.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: companyId || undefined },
    orderBy: { sortOrder: "asc" },
  });
  res.json(accounts);
};

export const createCompanyBankAccount: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const account = await prisma.companyBankAccount.create({
    data: { ...req.body, tenantId: req.auth!.tenantId },
  });
  res.status(201).json(account);
};

export const updateCompanyBankAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.companyBankAccount.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الحساب البنكي غير موجود");
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const account = await prisma.companyBankAccount.update({ where: { id: existing.id }, data: req.body });
  res.json(account);
};

export const deleteCompanyBankAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.companyBankAccount.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الحساب البنكي غير موجود");
  await prisma.companyBankAccount.delete({ where: { id: existing.id } });
  res.status(204).send();
};
