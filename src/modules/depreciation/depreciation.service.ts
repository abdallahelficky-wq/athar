import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { monthlyDepreciation } from "../../lib/depreciation";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("ar-SA", { year: "numeric", month: "long" });
}

export async function listDepreciationRuns(tenantId: string, filters: { companyId?: string }) {
  return prisma.depreciationRun.findMany({
    where: { tenantId, companyId: filters.companyId || undefined },
    orderBy: { createdAt: "desc" },
  });
}

async function activeAssetRows(tenantId: string, companyId: string) {
  const assets = await prisma.fixedAsset.findMany({ where: { tenantId, companyId, status: "active" } });
  return assets.map((a) => ({
    assetId: a.id,
    name: a.name,
    cost: Number(a.cost),
    usefulLifeYears: a.usefulLifeYears,
    monthly: monthlyDepreciation({ cost: Number(a.cost), salvageValue: Number(a.salvageValue), usefulLifeYears: a.usefulLifeYears }),
  }));
}

export async function previewDepreciation(tenantId: string, companyId: string, month: string) {
  const rows = await activeAssetRows(tenantId, companyId);
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  const existingRun = await prisma.depreciationRun.findFirst({ where: { tenantId, companyId, month } });
  return { rows, total, alreadyPosted: Boolean(existingRun), existingRun };
}

export async function postDepreciationRun(tenantId: string, userId: string, companyId: string, month: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");

  const existingRun = await prisma.depreciationRun.findFirst({ where: { tenantId, companyId, month } });
  if (existingRun) throw badRequest(`تم ترحيل إهلاك شهر ${monthLabel(month)} مسبقاً لهذه الشركة`);

  const rows = await activeAssetRows(tenantId, companyId);
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  if (total <= 0) throw badRequest("لا توجد أصول نشطة لحساب إهلاكها");

  const expenseAccountId = await getAccountIdByName(tenantId, "مصروف إهلاك الأصول الثابتة");
  const accDepAccountId = await getAccountIdByName(tenantId, "مجمع الإهلاك");

  // اليوم الثامن والعشرون من الشهر، مطابقةً لتاريخ الترحيل المستخدَم في الواجهة المرجعية
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1, 28);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId,
      date,
      memo: `إهلاك شهر ${monthLabel(month)}`,
      sourceModule: "depreciation",
      createdBy: userId,
      lines: [
        { accountId: expenseAccountId, department: "المالية والحسابات", debit: total, credit: 0 },
        { accountId: accDepAccountId, department: "المالية والحسابات", debit: 0, credit: total },
      ],
    });

    const run = await tx.depreciationRun.create({
      data: { tenantId, companyId, month, totalAmount: total, journalEntryId: entry.id },
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: run.id } });
    return run;
  });
}

/** فك ترحيل شهر إهلاك — يحذف القيد والسجل معاً ليمكن إعادة الترحيل لاحقاً بعد التصحيح */
export async function removeDepreciationRun(tenantId: string, userId: string, id: string, pin: string) {
  const run = await prisma.depreciationRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("سجل الإهلاك غير موجود");

  await assertValidUnlockPin(tenantId, pin);

  await prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, run.journalEntryId);
    await tx.depreciationRun.delete({ where: { id } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "DepreciationRun", entityId: id });
  });
}
