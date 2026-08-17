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
  // isDepreciable: true فقط هنا (بدل الفلترة داخل monthlyDepreciation) — أصول لا تُستهلك (مثل
  // الأراضي) لا تظهر أصلاً في معاينة/ترحيل الإهلاك، لا تُحسَب بصفر ضمن القائمة.
  const assets = await prisma.fixedAsset.findMany({
    where: { tenantId, companyId, status: "active", isDepreciable: true },
    include: { categoryRef: true },
  });
  return assets.map((a) => ({
    assetId: a.id,
    name: a.name,
    accountId: a.accountId,
    // فئة الأصل (إن وُجدت) تحمل حسابَي مصروف/مجمع إهلاك خاصَّين بها — يُفضَّلان على الحسابين
    // المشتركين القديمين، اللذين يبقيان fallback فقط لأصول بلا تصنيف.
    expenseAccountId: a.categoryRef?.depreciationExpenseAccountId ?? null,
    accDepAccountId: a.categoryRef?.accumulatedDepreciationAccountId ?? null,
    cost: Number(a.cost),
    usefulLifeYears: Number(a.usefulLifeYears),
    monthly: monthlyDepreciation({ cost: Number(a.cost), salvageValue: Number(a.salvageValue), usefulLifeYears: Number(a.usefulLifeYears), isDepreciable: a.isDepreciable }),
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

  // مصروف الإهلاك ومجمع الإهلاك: يُفضَّل حسابا فئة الأصل الخاصان به (Phase C) لكل أصل على حدة،
  // مع fallback للحسابين المشتركين القديمين لأصول بلا تصنيف — سطر مستقل لكل أصل (بدل سطر واحد
  // مجمَّع للإجمالي) موسوم بـ fixedAssetId، بنفس فلسفة إعادة كتابة postPayrollRun لسطور لكل
  // موظف/بند بدل سطر مجمَّع (Phase H4 سابقاً).
  const fallbackExpenseAccountId = await getAccountIdByName(tenantId, companyId, "مصروف إهلاك الأصول الثابتة");
  const fallbackAccDepAccountId = await getAccountIdByName(tenantId, companyId, "مجمع الإهلاك");

  // اليوم الثامن والعشرون من الشهر، مطابقةً لتاريخ الترحيل المستخدَم في الواجهة المرجعية
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1, 28);

  const lines = rows
    .filter((r) => r.monthly > 0)
    .flatMap((r) => [
      { accountId: r.expenseAccountId ?? fallbackExpenseAccountId, fixedAssetId: r.assetId, department: "المالية والحسابات", debit: r.monthly, credit: 0 },
      { accountId: r.accDepAccountId ?? fallbackAccDepAccountId, fixedAssetId: r.assetId, department: "المالية والحسابات", debit: 0, credit: r.monthly },
    ]);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId,
      date,
      memo: `إهلاك شهر ${monthLabel(month)}`,
      sourceModule: "depreciation",
      createdBy: userId,
      lines,
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
