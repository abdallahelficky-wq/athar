import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

const scopeCompanyId = (value: unknown) => (typeof value === "string" && value ? value : null);

async function validateHierarchy(tenantId: string, input: any, currentId?: string) {
  const companyId = input.companyId ?? null;
  const level = Number(input.level);
  if (level === 6 && !/^\d{9}$/.test(input.code)) throw badRequest("حساب المستوى السادس يجب أن يحمل كوداً من 9 أرقام");
  if (input.isPosting && level !== 6) throw badRequest("الإدخال مسموح فقط على حسابات المستوى السادس");
  if (level === 1 && input.parentId) throw badRequest("حساب المستوى الأول لا يقبل حساباً أباً");
  if (level > 1) {
    const parent = await prisma.account.findFirst({ where: { id: input.parentId, tenantId } });
    if (!parent) throw badRequest("اختر الحساب الأب");
    if (parent.id === currentId || parent.level !== level - 1 || (parent.companyId || null) !== companyId) {
      throw badRequest("الحساب الأب يجب أن يكون من المستوى السابق وفي الشجرة نفسها");
    }
  }
}

export const listAccounts: RequestHandler = async (req, res) => {
  const tree = req.query.tree === "true";
  const companyId = scopeCompanyId(req.query.companyId);
  const where = tree
    ? { tenantId: req.auth!.tenantId, companyId }
    : { tenantId: req.auth!.tenantId, isPosting: true, isArchived: false };
  const accounts = await prisma.account.findMany({ where, orderBy: [{ code: "asc" }, { name: "asc" }] });
  if (!tree) return res.json(accounts);

  const lines = await prisma.journalEntryLine.groupBy({
    by: ["accountId"],
    where: { journalEntry: { tenantId: req.auth!.tenantId, companyId: companyId || undefined } },
    _sum: { debit: true, credit: true },
  });
  const direct = new Map(lines.map((line) => [line.accountId, Number(line._sum.debit || 0) - Number(line._sum.credit || 0)]));
  const byParent = new Map<string | null, typeof accounts>();
  accounts.forEach((account) => byParent.set(account.parentId, [...(byParent.get(account.parentId) || []), account]));
  const balance = (account: (typeof accounts)[number]): number =>
    (direct.get(account.id) || 0) + (byParent.get(account.id) || []).reduce((sum, child) => sum + balance(child), 0);
  res.json(accounts.map((account) => ({ ...account, balance: balance(account) })));
};

export const createAccount: RequestHandler = async (req, res) => {
  await validateHierarchy(req.auth!.tenantId, req.body);
  const account = await prisma.account.create({ data: { ...req.body, tenantId: req.auth!.tenantId } });
  res.status(201).json(account);
};

export const updateAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.account.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الحساب غير موجود");
  const data = { ...existing, ...req.body };
  await validateHierarchy(req.auth!.tenantId, data, existing.id);
  const account = await prisma.account.update({ where: { id: existing.id }, data: req.body });
  res.json(account);
};

export const deleteAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.account.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الحساب غير موجود");
  const [children, lines] = await Promise.all([
    prisma.account.count({ where: { parentId: existing.id } }),
    prisma.journalEntryLine.count({ where: { accountId: existing.id } }),
  ]);
  if (children || lines) throw badRequest("لا يمكن حذف حساب له حسابات فرعية أو حركات؛ استخدم الأرشفة بدلاً من ذلك");
  await prisma.account.delete({ where: { id: existing.id } });
  res.status(204).send();
};
