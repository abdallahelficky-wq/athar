import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { accumulatedDepreciation } from "../../lib/depreciation";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";

const PAYMENT_ACCOUNT_NAME: Record<string, string> = {
  cash: "النقدية بالصندوق",
  bank: "البنك الأهلي - حساب تشغيلي",
  credit: "ذمم دائنة - موردين",
};

function withComputed<T extends { cost: unknown; salvageValue: unknown; usefulLifeYears: number; purchaseDate: Date }>(asset: T) {
  const accDep = accumulatedDepreciation(
    { cost: Number(asset.cost), salvageValue: Number(asset.salvageValue), usefulLifeYears: asset.usefulLifeYears, purchaseDate: asset.purchaseDate },
    new Date(),
  );
  return { ...asset, accumulatedDepreciation: accDep, netBookValue: Number(asset.cost) - accDep };
}

export async function listFixedAssets(tenantId: string, filters: { companyId?: string }) {
  const assets = await prisma.fixedAsset.findMany({
    where: { tenantId, companyId: filters.companyId || undefined },
    orderBy: { createdAt: "desc" },
  });
  return assets.map(withComputed);
}

export async function getFixedAssetsSummary(tenantId: string, filters: { companyId?: string }) {
  const assets = await listFixedAssets(tenantId, filters);
  const active = assets.filter((a) => a.status === "active");
  const disposed = assets.filter((a) => a.status === "disposed");

  const byCategory = new Map<string, { category: string; cost: number; count: number }>();
  assets.forEach((a) => {
    const cat = a.category || "غير مصنّف";
    const row = byCategory.get(cat) || { category: cat, cost: 0, count: 0 };
    row.cost += Number(a.cost);
    row.count += 1;
    byCategory.set(cat, row);
  });

  return {
    activeCount: active.length,
    disposedCount: disposed.length,
    totalCost: assets.reduce((s, a) => s + Number(a.cost), 0),
    totalNetBookValue: active.reduce((s, a) => s + a.netBookValue, 0),
    byCategory: [...byCategory.values()],
  };
}

export async function createFixedAsset(
  tenantId: string,
  userId: string,
  input: { companyId: string; name: string; category?: string; purchaseDate: Date; cost: number; usefulLifeYears: number; salvageValue: number; paymentMethod: "cash" | "bank" | "credit" },
) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");

  const assetAccountId = await getAccountIdByName(tenantId, "الأصول الثابتة");
  const creditAccountId = await getAccountIdByName(tenantId, PAYMENT_ACCOUNT_NAME[input.paymentMethod]);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.purchaseDate,
      memo: `شراء أصل ثابت — ${input.name}`,
      sourceModule: "manual",
      createdBy: userId,
      lines: [
        { accountId: assetAccountId, department: "المالية والحسابات", debit: input.cost, credit: 0 },
        { accountId: creditAccountId, department: "المالية والحسابات", debit: 0, credit: input.cost },
      ],
    });

    const asset = await tx.fixedAsset.create({
      data: {
        tenantId,
        companyId: input.companyId,
        name: input.name,
        category: input.category,
        purchaseDate: input.purchaseDate,
        cost: input.cost,
        usefulLifeYears: input.usefulLifeYears,
        salvageValue: input.salvageValue,
        status: "active",
        journalEntryId: entry.id,
      },
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: asset.id } });
    return withComputed(asset);
  });
}

export async function updateFixedAsset(
  tenantId: string,
  id: string,
  input: { name?: string; category?: string; usefulLifeYears?: number; salvageValue?: number },
) {
  const existing = await prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الأصل غير موجود");
  if (existing.status === "disposed") throw badRequest("لا يمكن تعديل أصل مستبعد");

  const asset = await prisma.fixedAsset.update({ where: { id }, data: input });
  return withComputed(asset);
}

/**
 * حذف أصل قبل استبعاده (لتصحيح خطأ إدخال) — محمي برقم سري لأنه يحذف قيد الشراء المرتبط،
 * وفق القسم 4.9. لا يُسمح بحذف أصل تم استبعاده بالفعل (استخدم دورة الاستبعاد بدلاً من ذلك).
 */
export async function removeFixedAsset(tenantId: string, userId: string, id: string, pin: string) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  if (!asset) throw notFound("الأصل غير موجود");
  if (asset.status === "disposed") throw badRequest("لا يمكن حذف أصل مستبعد بالفعل");

  await assertValidUnlockPin(tenantId, pin);

  await prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, asset.journalEntryId);
    await tx.fixedAsset.delete({ where: { id } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "FixedAsset", entityId: id });
  });
}

export async function disposeFixedAsset(
  tenantId: string,
  userId: string,
  id: string,
  input: { disposalDate: Date; salePrice: number; method: "cash" | "bank" },
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  if (!asset) throw notFound("الأصل غير موجود");
  if (asset.status === "disposed") throw badRequest("تم استبعاد هذا الأصل مسبقاً");

  const accDep = accumulatedDepreciation(
    { cost: Number(asset.cost), salvageValue: Number(asset.salvageValue), usefulLifeYears: asset.usefulLifeYears, purchaseDate: asset.purchaseDate },
    input.disposalDate,
  );
  const nbv = Number(asset.cost) - accDep;
  const gainLoss = input.salePrice - nbv;

  const accDepAccountId = await getAccountIdByName(tenantId, "مجمع الإهلاك");
  const assetAccountId = await getAccountIdByName(tenantId, "الأصول الثابتة");
  const receiveAccountId = await getAccountIdByName(tenantId, input.method === "cash" ? "النقدية بالصندوق" : "البنك الأهلي - حساب تشغيلي");

  const lines: { accountId: string; department: string; debit: number; credit: number }[] = [
    { accountId: accDepAccountId, department: "المالية والحسابات", debit: accDep, credit: 0 },
  ];
  if (input.salePrice > 0) lines.push({ accountId: receiveAccountId, department: "المالية والحسابات", debit: input.salePrice, credit: 0 });
  if (gainLoss > 0) {
    const gainAccountId = await getAccountIdByName(tenantId, "أرباح استبعاد أصول");
    lines.push({ accountId: gainAccountId, department: "المالية والحسابات", debit: 0, credit: gainLoss });
  } else if (gainLoss < 0) {
    const lossAccountId = await getAccountIdByName(tenantId, "خسائر استبعاد أصول");
    lines.push({ accountId: lossAccountId, department: "المالية والحسابات", debit: -gainLoss, credit: 0 });
  }
  lines.push({ accountId: assetAccountId, department: "المالية والحسابات", debit: 0, credit: Number(asset.cost) });

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: asset.companyId,
      date: input.disposalDate,
      memo: `استبعاد أصل — ${asset.name}`,
      sourceModule: "asset_disposal",
      sourceId: asset.id,
      createdBy: userId,
      lines,
    });

    const updated = await tx.fixedAsset.update({
      where: { id },
      data: { status: "disposed", disposalDate: input.disposalDate, disposalValue: input.salePrice },
    });
    return { ...withComputed(updated), accumulatedDepreciationAtDisposal: accDep, gainLoss, journalEntryId: entry.id };
  });
}
