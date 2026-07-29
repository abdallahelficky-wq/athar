import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

const scopeCompanyId = (value: unknown) => (typeof value === "string" && value ? value : null);

async function validateHierarchy(tenantId: string, input: any, currentId?: string) {
  const companyId = input.companyId ?? null;
  const level = Number(input.level);
  if (level === 6 && !/^\d{9}$/.test(input.code)) throw badRequest("حساب المستوى السادس يجب أن يحمل كوداً من 9 أرقام");
  if (input.isPosting && (level < 2 || level > 6)) throw badRequest("حساب الترحيل يجب أن يكون بين المستوى الثاني والسادس");
  if (level === 1 && input.parentId) throw badRequest("حساب المستوى الأول لا يقبل حساباً أباً");
  if (level > 1) {
    const parent = await prisma.account.findFirst({ where: { id: input.parentId, tenantId } });
    if (!parent) throw badRequest("اختر الحساب الأب");
    if (parent.isPosting) throw badRequest("لا يمكن إضافة حساب فرعي تحت حساب ترحيل");
    if (parent.id === currentId || parent.level !== level - 1 || (parent.companyId || null) !== companyId) {
      throw badRequest("الحساب الأب يجب أن يكون من المستوى السابق وفي الشجرة نفسها");
    }
  }
  if (input.isPosting && currentId) {
    const children = await prisma.account.count({ where: { parentId: currentId } });
    if (children) throw badRequest("لا يمكن تحويل حساب له حسابات فرعية إلى حساب ترحيل");
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

export const importAccounts: RequestHandler = async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const companyId = req.body.companyId ?? null;
  const rows = req.body.rows as Array<{
    code: string;
    name: string;
    nameEn: string;
    type: "asset" | "liability" | "equity" | "revenue" | "expense";
    level: number;
    isPosting: boolean;
    parentCode?: string | null;
    isBankOrCash?: boolean;
  }>;

  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
    if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  }

  const codeCounts = new Map<string, number>();
  rows.forEach((row) => codeCounts.set(row.code, (codeCounts.get(row.code) || 0) + 1));
  const duplicateCodes = [...codeCounts.entries()].filter(([, count]) => count > 1).map(([code]) => code);
  if (duplicateCodes.length) throw badRequest("ملف الاستيراد يحتوي على أكواد مكررة", { duplicateCodes });

  const existing = await prisma.account.findMany({
    where: { tenantId, companyId, code: { in: rows.map((row) => row.code) } },
    select: { code: true },
  });
  if (existing.length) {
    throw badRequest("بعض الأكواد موجودة بالفعل في الشجرة المحددة", { existingCodes: existing.map((row) => row.code) });
  }

  for (const row of rows) {
    if (row.level === 6 && !/^\d{9}$/.test(row.code)) {
      throw badRequest(`حساب المستوى السادس ${row.code} يجب أن يحمل كوداً من 9 أرقام`);
    }
    if (row.isPosting && row.level < 2) throw badRequest(`الحساب ${row.code}: حساب الترحيل يجب أن يكون بين المستوى الثاني والسادس`);
    if (row.level === 1 && row.parentCode) throw badRequest(`الحساب ${row.code} من المستوى الأول ولا يقبل حساباً أباً`);
    if (row.level > 1 && !row.parentCode) throw badRequest(`الحساب الأب مفقود للكود ${row.code}`);
  }
  const importedChildren = new Set(rows.map((row) => row.parentCode).filter(Boolean));
  const postingParents = rows.filter((row) => row.isPosting && importedChildren.has(row.code)).map((row) => row.code);
  if (postingParents.length) {
    throw badRequest("حساب الترحيل لا يمكن أن يحتوي على حسابات فرعية", { postingParents });
  }

  const orderedRows = [...rows].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
  const created = await prisma.$transaction(async (tx) => {
    const existingParents = await tx.account.findMany({ where: { tenantId, companyId } });
    const accountsByCode = new Map(existingParents.map((account) => [account.code, account]));
    const result = [];

    for (const row of orderedRows) {
      const parent = row.level > 1 ? accountsByCode.get(row.parentCode as string) : null;
      if (row.level > 1 && (!parent || parent.level !== row.level - 1)) {
        throw badRequest(`الحساب الأب ${row.parentCode} غير موجود بالمستوى السابق للحساب ${row.code}`);
      }
      if (parent?.isPosting) throw badRequest(`الحساب الأب ${row.parentCode} هو حساب ترحيل ولا يقبل حسابات فرعية`);
      const account = await tx.account.create({
        data: {
          tenantId,
          companyId,
          parentId: parent?.id || null,
          code: row.code,
          name: row.name.trim(),
          nameEn: row.nameEn.trim(),
          type: row.type,
          level: row.level,
          isPosting: row.isPosting,
          isBankOrCash: Boolean(row.isBankOrCash && row.type === "asset" && row.isPosting),
        },
      });
      accountsByCode.set(account.code, account);
      result.push(account);
    }
    return result;
  });

  res.status(201).json({ imported: created.length });
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
