import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

type AccountRole = "asset" | "accumulatedDepreciation" | "depreciationExpense";

const ROLE_LABEL: Record<AccountRole, string> = {
  asset: "حساب اقتناء الأصل",
  accumulatedDepreciation: "حساب مجمع الإهلاك",
  depreciationExpense: "حساب مصروف الإهلاك",
};

// النوع المطلوب لكل دور — مجمع الإهلاك حساب "أصول" عكسي في هذه الشجرة (وفق الفحص الفعلي للبيانات
// الحية)، وليس نوعاً منفصلاً، لذا يُقبل "asset" له تماماً مثل حساب الاقتناء نفسه.
const ROLE_TYPE: Record<AccountRole, "asset" | "expense"> = {
  asset: "asset",
  accumulatedDepreciation: "asset",
  depreciationExpense: "expense",
};

async function assertValidRoleAccount(tenantId: string, companyId: string, accountId: string, role: AccountRole) {
  const account = await prisma.account.findFirst({ where: { id: accountId, tenantId, companyId } });
  if (!account) throw badRequest(`${ROLE_LABEL[role]}: الحساب المختار غير موجود ضمن شجرة هذه الشركة`);
  if (!account.isPosting || !account.isActive || account.isArchived) throw badRequest(`${ROLE_LABEL[role]}: الحساب المختار ليس حساب ترحيل نشطاً`);
  if (account.type !== ROLE_TYPE[role]) throw badRequest(`${ROLE_LABEL[role]}: نوع الحساب المختار غير مطابق (متوقَّع ${ROLE_TYPE[role]})`);
  return account;
}

function assertDistinctAccounts(ids: { assetAccountId: string; accumulatedDepreciationAccountId: string; depreciationExpenseAccountId: string }) {
  const values = [ids.assetAccountId, ids.accumulatedDepreciationAccountId, ids.depreciationExpenseAccountId];
  if (new Set(values).size !== values.length) throw badRequest("لا يمكن استخدام نفس الحساب لأكثر من دور ضمن نفس الفئة");
}

/** يُعيد ضبط isFixedAssetAccount على حساب اقتناء أصل — يُفعَّل فقط طالما ترتبط به فئة واحدة على الأقل. */
async function syncFixedAssetAccountFlag(tx: Prisma.TransactionClient, tenantId: string, accountId: string) {
  const stillLinked = await tx.assetCategory.count({ where: { tenantId, assetAccountId: accountId } });
  await tx.account.update({ where: { id: accountId }, data: { isFixedAssetAccount: stillLinked > 0 } });
}

export async function listAssetCategories(tenantId: string, filters: { companyId?: string }) {
  return prisma.assetCategory.findMany({
    where: { tenantId, companyId: filters.companyId || undefined },
    include: { assetAccount: true, accumulatedDepreciationAccount: true, depreciationExpenseAccount: true },
    orderBy: [{ groupName: "asc" }, { name: "asc" }],
  });
}

export async function createAssetCategory(
  tenantId: string,
  input: {
    companyId: string;
    groupName: string;
    name: string;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    depreciationExpenseAccountId: string;
  },
) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");

  assertDistinctAccounts(input);
  await assertValidRoleAccount(tenantId, input.companyId, input.assetAccountId, "asset");
  await assertValidRoleAccount(tenantId, input.companyId, input.accumulatedDepreciationAccountId, "accumulatedDepreciation");
  await assertValidRoleAccount(tenantId, input.companyId, input.depreciationExpenseAccountId, "depreciationExpense");

  const duplicate = await prisma.assetCategory.findFirst({ where: { tenantId, companyId: input.companyId, name: input.name } });
  if (duplicate) throw badRequest("يوجد بالفعل فئة أصول بنفس هذا الاسم في هذه الشركة");

  return prisma.$transaction(async (tx) => {
    const category = await tx.assetCategory.create({ data: { tenantId, ...input } });
    await tx.account.update({ where: { id: input.assetAccountId }, data: { isFixedAssetAccount: true } });
    return category;
  });
}

export async function updateAssetCategory(
  tenantId: string,
  id: string,
  input: {
    groupName?: string;
    name?: string;
    assetAccountId?: string;
    accumulatedDepreciationAccountId?: string;
    depreciationExpenseAccountId?: string;
  },
) {
  const existing = await prisma.assetCategory.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("فئة الأصول غير موجودة");

  const merged = {
    assetAccountId: input.assetAccountId ?? existing.assetAccountId,
    accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId ?? existing.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: input.depreciationExpenseAccountId ?? existing.depreciationExpenseAccountId,
  };
  assertDistinctAccounts(merged);

  if (input.assetAccountId) await assertValidRoleAccount(tenantId, existing.companyId, input.assetAccountId, "asset");
  if (input.accumulatedDepreciationAccountId) {
    await assertValidRoleAccount(tenantId, existing.companyId, input.accumulatedDepreciationAccountId, "accumulatedDepreciation");
  }
  if (input.depreciationExpenseAccountId) {
    await assertValidRoleAccount(tenantId, existing.companyId, input.depreciationExpenseAccountId, "depreciationExpense");
  }

  if (input.name && input.name !== existing.name) {
    const duplicate = await prisma.assetCategory.findFirst({ where: { tenantId, companyId: existing.companyId, name: input.name, id: { not: id } } });
    if (duplicate) throw badRequest("يوجد بالفعل فئة أصول بنفس هذا الاسم في هذه الشركة");
  }

  return prisma.$transaction(async (tx) => {
    const category = await tx.assetCategory.update({ where: { id }, data: input });
    if (input.assetAccountId && input.assetAccountId !== existing.assetAccountId) {
      await tx.account.update({ where: { id: input.assetAccountId }, data: { isFixedAssetAccount: true } });
      await syncFixedAssetAccountFlag(tx, tenantId, existing.assetAccountId);
    }
    return category;
  });
}

export async function removeAssetCategory(tenantId: string, id: string) {
  const existing = await prisma.assetCategory.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("فئة الأصول غير موجودة");

  const inUse = await prisma.fixedAsset.count({ where: { categoryId: id } });
  if (inUse > 0) throw badRequest("لا يمكن حذف فئة مرتبطة بأصول مسجَّلة بالفعل");

  await prisma.$transaction(async (tx) => {
    await tx.assetCategory.delete({ where: { id } });
    await syncFixedAssetAccountFlag(tx, tenantId, existing.assetAccountId);
  });
}
