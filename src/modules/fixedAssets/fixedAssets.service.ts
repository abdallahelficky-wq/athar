import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { accumulatedDepreciation, accumulatedDepreciationExisting } from "../../lib/depreciation";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { formatDocNumber } from "../../lib/docNumber";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";

const PAYMENT_ACCOUNT_NAME: Record<string, string> = {
  cash: "النقدية بالصندوق",
  bank: "البنك الأهلي - حساب تشغيلي",
  credit: "ذمم دائنة - موردين",
};

type ComputedInput = {
  cost: unknown;
  salvageValue: unknown;
  usefulLifeYears: unknown;
  purchaseDate: Date;
  depreciationStartDate: Date | null;
  isDepreciable: boolean;
  isExisting?: boolean;
  openingAccumulatedDepreciation?: unknown;
  openingDepreciationAsOf?: Date | null;
};

/**
 * مجمع إهلاك الأصل حتى تاريخ معيّن: أصل عادي من تاريخ بدء الإهلاك، وأصل قائم من مجمعه الافتتاحي المُرحَّل فعلاً
 * في الدفاتر + أقساط الأشهر اللاحقة فقط. مصدر واحد للعرض والاستبعاد حتى لا يختلف رقم الشاشة عن قيد الاستبعاد.
 */
function accumulatedFor(asset: ComputedInput, uptoDate: Date) {
  if (asset.isExisting && asset.openingDepreciationAsOf) {
    return accumulatedDepreciationExisting(
      {
        cost: Number(asset.cost),
        salvageValue: Number(asset.salvageValue),
        usefulLifeYears: Number(asset.usefulLifeYears),
        isDepreciable: asset.isDepreciable,
        openingAccumulatedDepreciation: Number(asset.openingAccumulatedDepreciation ?? 0),
        openingDepreciationAsOf: asset.openingDepreciationAsOf,
      },
      uptoDate,
    );
  }
  return accumulatedDepreciation(
    {
      cost: Number(asset.cost),
      salvageValue: Number(asset.salvageValue),
      usefulLifeYears: Number(asset.usefulLifeYears),
      purchaseDate: asset.depreciationStartDate ?? asset.purchaseDate,
      isDepreciable: asset.isDepreciable,
    },
    uptoDate,
  );
}

function withComputed<T extends ComputedInput>(asset: T) {
  const accDep = accumulatedFor(asset, new Date());
  return { ...asset, accumulatedDepreciation: accDep, netBookValue: Number(asset.cost) - accDep };
}

/** رصيد حساب (مدين − دائن) من القيود المرحَّلة فقط حتى تاريخ اختياري — أساس حواجز منع التسجيل المزدوج. */
async function postedDebitBalance(tx: Prisma.TransactionClient, tenantId: string, companyId: string, accountId: string, upto?: Date) {
  const agg = await tx.journalEntryLine.aggregate({
    _sum: { debit: true, credit: true },
    where: { accountId, journalEntry: { tenantId, companyId, status: "posted", ...(upto ? { date: { lte: upto } } : {}) } },
  });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}

/**
 * يتحقق أن الحساب المُختار للأصل ينتمي فعلاً لهذه الشركة، حساب ترحيل نشط، ومن نوع "أصول". يقبل
 * إما عميل Prisma العادي أو عميل معاملة (tx) — يُستدعى أحياناً خارج أي معاملة (مثل التحقق المبدئي
 * في updateFixedAsset) وأحياناً داخل معاملة الاستدعاء (عبر registerFixedAssetTx أدناه).
 */
async function assertValidAssetAccount(tx: Prisma.TransactionClient, tenantId: string, companyId: string, accountId: string) {
  const account = await tx.account.findFirst({ where: { id: accountId, tenantId, companyId } });
  if (!account) throw badRequest("الحساب المحاسبي المختار غير موجود ضمن شجرة هذه الشركة");
  if (!account.isPosting || !account.isActive || account.isArchived) throw badRequest("الحساب المحاسبي المختار ليس حساب ترحيل نشطاً");
  if (account.type !== "asset") throw badRequest("الحساب المحاسبي المختار ليس من نوع أصول");
  return account;
}

/**
 * يشتق حساب الأصل من فئة مختارة (categoryId) بدل اختيار حساب خام — يتحقق أن الفئة تنتمي لنفس
 * الشركة. لو لم تُختَر فئة، accountId الخام يبقى الفallback (Phase B، أصول قديمة/بلا تصنيف).
 */
export async function resolveAssetAccount(tx: Prisma.TransactionClient, tenantId: string, companyId: string, input: { categoryId?: string; accountId?: string }) {
  if (input.categoryId) {
    const category = await tx.assetCategory.findFirst({ where: { id: input.categoryId, tenantId, companyId } });
    if (!category) throw badRequest("فئة الأصل المختارة غير موجودة ضمن هذه الشركة");
    return { accountId: category.assetAccountId, categoryId: category.id };
  }
  if (input.accountId) {
    await assertValidAssetAccount(tx, tenantId, companyId, input.accountId);
    return { accountId: input.accountId, categoryId: null as string | null };
  }
  throw badRequest("اختر فئة الأصل أو الحساب المحاسبي");
}

async function nextAssetNumber(tx: Prisma.TransactionClient, tenantId: string, companyId: string) {
  const existingCount = await tx.fixedAsset.count({ where: { tenantId, companyId } });
  return formatDocNumber("AST", existingCount);
}

export type RegisterFixedAssetInput = {
  companyId: string;
  categoryId?: string;
  accountId?: string;
  name: string;
  category?: string;
  serialNumber?: string;
  chassisNumber?: string;
  plateNumber?: string;
  costCenterId?: string;
  custodianEmployeeId?: string;
  purchaseDate: Date;
  depreciationStartDate?: Date;
  cost: number;
  usefulLifeYears: number;
  salvageValue: number;
  depreciationMethod?: "straight_line" | "declining_balance";
  isDepreciable?: boolean;
  journalEntryId?: string;
  sourcePurchaseInvoiceLineId?: string;
  sourceJournalEntryLineId?: string;
  isExisting?: boolean;
  openingAccumulatedDepreciation?: number;
  openingDepreciationAsOf?: Date;
};

/**
 * ينشئ سجل أصل ثابت فقط — بلا أي قيد محاسبي خاص به (Phase D). القيد (إن وُجد) مسؤولية المستدعي
 * بالكامل: يمرَّر journalEntryId جاهزاً لو كان القيد موجوداً مسبقاً (فاتورة مشتريات، سطر قيد يومية
 * عام)، أو يُترَك فارغاً ليُحدَّث لاحقاً (مسار "سجل الأصول" اليدوي في createFixedAsset أدناه، الذي
 * يُنشئ قيد الشراء الخاص به بعد استدعاء هذه الدالة مباشرة ضمن نفس المعاملة). هذا يوحّد كل مسارات
 * إنشاء أصل ثابت (يدوي، فاتورة مشتريات، ولاحقاً نافذة اختيار الأصل داخل قيد يومية — Phase F) على
 * نفس منطق التحقق والاشتقاق بدل تكراره في كل موديول.
 */
export async function registerFixedAssetTx(tx: Prisma.TransactionClient, tenantId: string, input: RegisterFixedAssetInput) {
  const { accountId, categoryId } = await resolveAssetAccount(tx, tenantId, input.companyId, input);

  if (input.costCenterId) {
    const costCenter = await tx.costCenter.findFirst({ where: { id: input.costCenterId, tenantId, companyId: input.companyId } });
    if (!costCenter) throw badRequest("الموقع/الفرع المختار غير موجود ضمن هذه الشركة");
  }
  if (input.custodianEmployeeId) {
    const employee = await tx.employee.findFirst({ where: { id: input.custodianEmployeeId, tenantId, companyId: input.companyId } });
    if (!employee) throw badRequest("الموظف المختار كعهدة غير موجود ضمن هذه الشركة");
  }

  const asset = await tx.fixedAsset.create({
    data: {
      tenantId,
      companyId: input.companyId,
      accountId,
      categoryId,
      assetNumber: await nextAssetNumber(tx, tenantId, input.companyId),
      name: input.name,
      category: input.category,
      serialNumber: input.serialNumber,
      chassisNumber: input.chassisNumber,
      plateNumber: input.plateNumber,
      costCenterId: input.costCenterId,
      custodianEmployeeId: input.custodianEmployeeId,
      purchaseDate: input.purchaseDate,
      depreciationStartDate: input.depreciationStartDate,
      cost: input.cost,
      usefulLifeYears: input.usefulLifeYears,
      salvageValue: input.salvageValue,
      depreciationMethod: input.depreciationMethod ?? "straight_line",
      isDepreciable: input.isDepreciable ?? true,
      status: "active",
      journalEntryId: input.journalEntryId,
      sourcePurchaseInvoiceLineId: input.sourcePurchaseInvoiceLineId,
      sourceJournalEntryLineId: input.sourceJournalEntryLineId,
      isExisting: input.isExisting ?? false,
      openingAccumulatedDepreciation: input.openingAccumulatedDepreciation ?? 0,
      openingDepreciationAsOf: input.openingDepreciationAsOf,
    },
  });
  return { asset, accountId };
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
  input: {
    companyId: string;
    categoryId?: string;
    accountId?: string;
    name: string;
    category?: string;
    serialNumber?: string;
    chassisNumber?: string;
    plateNumber?: string;
    costCenterId?: string;
    custodianEmployeeId?: string;
    purchaseDate: Date;
    depreciationStartDate?: Date;
    cost: number;
    usefulLifeYears: number;
    salvageValue: number;
    depreciationMethod: "straight_line" | "declining_balance";
    isDepreciable: boolean;
    paymentMethod: "cash" | "bank" | "credit";
    source?: "purchase" | "cip_transfer" | "existing";
    cipAccountId?: string;
    openingAccumulatedDepreciation?: number;
    openingDepreciationAsOf?: Date;
  },
) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");

  const source = input.source ?? "purchase";
  if (source === "existing") return createExistingFixedAsset(tenantId, input);

  // مسار "شراء جديد" يرسم الدائن من وسيلة السداد؛ مسار "تحويل من مشروعات" يرسمه من حساب المشروعات المختار.
  const creditAccountId = source === "purchase" ? await getAccountIdByName(tenantId, input.companyId, PAYMENT_ACCOUNT_NAME[input.paymentMethod]) : null;

  return prisma.$transaction(async (tx) => {
    // الأصل يُنشأ أولاً (بلا journalEntryId بعد) حتى يمكن ربط سطر القيد بمعرّفه مباشرة، بدل تحديث
    // السطر لاحقاً بعد إنشائه — تتبّع كامل من أول لحظة.
    const { asset, accountId } = await registerFixedAssetTx(tx, tenantId, { ...input, isExisting: false, openingAccumulatedDepreciation: 0, openingDepreciationAsOf: undefined });

    let creditId = creditAccountId;
    if (source === "cip_transfer") {
      const cip = await assertValidAssetAccount(tx, tenantId, input.companyId, input.cipAccountId!);
      if (cip.id === accountId) throw badRequest("حساب المشروعات تحت التنفيذ لا يمكن أن يكون نفسه حساب الأصل");
      // لا يُحوَّل من المشروعات أكثر مما فيها فعلاً حتى تاريخ التحويل — وإلا صار رصيده دائناً بلا مبرر.
      const cipBalance = await postedDebitBalance(tx, tenantId, input.companyId, cip.id, input.purchaseDate);
      if (input.cost > cipBalance + 0.005) {
        throw badRequest(`تكلفة الأصل (${input.cost.toFixed(2)}) أكبر من رصيد حساب المشروعات تحت التنفيذ حتى تاريخ التحويل (${cipBalance.toFixed(2)})`);
      }
      creditId = cip.id;
    }

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.purchaseDate,
      memo: source === "cip_transfer" ? `تحويل من مشروعات تحت التنفيذ إلى أصل ثابت — ${input.name}` : `شراء أصل ثابت — ${input.name}`,
      sourceModule: "manual",
      createdBy: userId,
      lines: [
        { accountId, costCenterId: input.costCenterId, fixedAssetId: asset.id, department: "المالية والحسابات", debit: input.cost, credit: 0 },
        { accountId: creditId!, department: "المالية والحسابات", debit: 0, credit: input.cost },
      ],
    });

    const updated = await tx.fixedAsset.update({ where: { id: asset.id }, data: { journalEntryId: entry.id } });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: asset.id } });
    return withComputed(updated);
  });
}

/**
 * تسجيل أصل قائم في السجل بلا أي قيد جديد: تكلفته مُرحَّلة أصلاً في دفتر الأستاذ على حساب أصله (قيد افتتاحي، تحويل
 * سابق من مشروعات تحت التنفيذ…)، ومجمع إهلاكه الافتتاحي مُرحَّل أيضاً. التسجيل هنا يربط الأصل بالسجل ليُهلَك شهرياً
 * ويُباع/يُستبعد فقط. حاجزان يمنعان التضاعف: مجموع تكاليف أصول الحساب في السجل ≤ رصيده الدفتري المُرحَّل، ومجموع
 * المجمعات الافتتاحية ≤ رصيد حساب مجمع إهلاك الفئة. بلا مرآة: السجل لا يُنسَخ بين الشركات؛ والحذف/الاستبعاد يعملان
 * على الأصل (لا قيد شراء لحذفه — journalEntryId فارغ).
 */
async function createExistingFixedAsset(
  tenantId: string,
  input: Parameters<typeof registerFixedAssetTx>[2] & { openingAccumulatedDepreciation?: number; openingDepreciationAsOf?: Date },
) {
  const opening = input.openingAccumulatedDepreciation ?? 0;
  if (!input.openingDepreciationAsOf) throw badRequest("حدّد تاريخ آخر إهلاك مُرحَّل في الدفاتر للأصل القائم");
  if (opening > input.cost - (input.salvageValue || 0) + 0.005) {
    throw badRequest("مجمع الإهلاك الافتتاحي أكبر من القيمة القابلة للإهلاك (التكلفة − القيمة التخريدية)");
  }

  return prisma.$transaction(async (tx) => {
    const { accountId, categoryId } = await resolveAssetAccount(tx, tenantId, input.companyId, input);

    const registered = await tx.fixedAsset.aggregate({ _sum: { cost: true }, where: { tenantId, companyId: input.companyId, accountId, status: "active" } });
    const registeredCost = Number(registered._sum.cost ?? 0);
    const ledgerBalance = await postedDebitBalance(tx, tenantId, input.companyId, accountId);
    if (registeredCost + input.cost > ledgerBalance + 0.005) {
      throw badRequest(
        `تكلفة الأصل مع الأصول المسجَّلة على هذا الحساب (${(registeredCost + input.cost).toFixed(2)}) تتجاوز رصيده الدفتري (${ledgerBalance.toFixed(2)}) — الأصل القائم يجب أن يكون مُرحَّلاً في الأستاذ أصلاً`,
      );
    }

    if (categoryId && opening > 0) {
      const category = await tx.assetCategory.findFirstOrThrow({ where: { id: categoryId, tenantId, companyId: input.companyId } });
      const accDepAccountId = category.accumulatedDepreciationAccountId;
      const bookedAcc = -(await postedDebitBalance(tx, tenantId, input.companyId, accDepAccountId));
      const registeredAcc = await tx.fixedAsset.aggregate({
        _sum: { openingAccumulatedDepreciation: true },
        where: { tenantId, companyId: input.companyId, isExisting: true, status: "active", categoryRef: { accumulatedDepreciationAccountId: accDepAccountId } },
      });
      const total = Number(registeredAcc._sum.openingAccumulatedDepreciation ?? 0) + opening;
      if (total > bookedAcc + 0.005) {
        throw badRequest(
          `مجمع الإهلاك الافتتاحي مع المسجَّل لنفس الفئة (${total.toFixed(2)}) يتجاوز رصيد حساب مجمع الإهلاك في الدفاتر (${bookedAcc.toFixed(2)})`,
        );
      }
    }

    const { asset } = await registerFixedAssetTx(tx, tenantId, { ...input, isExisting: true, openingAccumulatedDepreciation: opening });
    return withComputed(asset);
  });
}

export async function updateFixedAsset(
  tenantId: string,
  id: string,
  input: {
    categoryId?: string | null;
    accountId?: string;
    name?: string;
    category?: string;
    serialNumber?: string;
    chassisNumber?: string;
    plateNumber?: string;
    costCenterId?: string;
    custodianEmployeeId?: string | null;
    depreciationStartDate?: Date;
    usefulLifeYears?: number;
    salvageValue?: number;
    depreciationMethod?: "straight_line" | "declining_balance";
    isDepreciable?: boolean;
  },
) {
  const existing = await prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الأصل غير موجود");
  if (existing.status === "disposed") throw badRequest("لا يمكن تعديل أصل مستبعد");

  const { categoryId, accountId, custodianEmployeeId, ...rest } = input;

  let accountUpdate: { accountId?: string; categoryId?: string | null } = {};
  if (categoryId) {
    // فئة جديدة مختارة صراحةً — تشتق الحساب منها وتتجاهل accountId خام لو أُرسل معاً.
    accountUpdate = await resolveAssetAccount(prisma, tenantId, existing.companyId, { categoryId });
  } else if (categoryId === null) {
    // إلغاء الفئة صراحةً — يتطلب حساباً خاماً بديلاً في نفس الطلب.
    if (!accountId) throw badRequest("عند إلغاء ربط الأصل بفئة، اختر حساباً محاسبياً بديلاً");
    await assertValidAssetAccount(prisma, tenantId, existing.companyId, accountId);
    accountUpdate = { accountId, categoryId: null };
  } else if (accountId) {
    // حساب خام صريح بلا تغيير فئة — يُلغي الربط بأي فئة سابقة حتى لا يتعارض الحساب المعروض معها.
    await assertValidAssetAccount(prisma, tenantId, existing.companyId, accountId);
    accountUpdate = { accountId, categoryId: null };
  }

  if (input.costCenterId) {
    const costCenter = await prisma.costCenter.findFirst({ where: { id: input.costCenterId, tenantId, companyId: existing.companyId } });
    if (!costCenter) throw badRequest("الموقع/الفرع المختار غير موجود ضمن هذه الشركة");
  }
  if (custodianEmployeeId) {
    const employee = await prisma.employee.findFirst({ where: { id: custodianEmployeeId, tenantId, companyId: existing.companyId } });
    if (!employee) throw badRequest("الموظف المختار كعهدة غير موجود ضمن هذه الشركة");
  }

  const asset = await prisma.fixedAsset.update({
    where: { id },
    data: { ...rest, ...accountUpdate, custodianEmployeeId: custodianEmployeeId === undefined ? undefined : custodianEmployeeId },
  });
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

  await assertValidUnlockPin(tenantId, pin, userId);

  await prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, asset.journalEntryId);
    await tx.fixedAsset.delete({ where: { id } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, companyId: asset.companyId, entityType: "FixedAsset", entityId: id });
  });
}

export async function disposeFixedAsset(
  tenantId: string,
  userId: string,
  id: string,
  input: { disposalDate: Date; salePrice: number; method: "cash" | "bank" },
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, tenantId }, include: { categoryRef: true } });
  if (!asset) throw notFound("الأصل غير موجود");
  if (asset.status === "disposed") throw badRequest("تم استبعاد هذا الأصل مسبقاً");

  const accDep = accumulatedFor(asset, input.disposalDate);
  const nbv = Number(asset.cost) - accDep;
  const gainLoss = input.salePrice - nbv;

  // فئة الأصل (إن وُجدت) تحمل حساب مجمع إهلاك خاصاً بها — يُفضَّل على الحساب المشترك القديم.
  const accDepAccountId = asset.categoryRef?.accumulatedDepreciationAccountId ?? (await getAccountIdByName(tenantId, asset.companyId, "مجمع الإهلاك"));
  // الحساب الفعلي الذي سُجِّل عليه هذا الأصل تحديداً — بدل حساب "الأصول الثابتة" المشترك القديم.
  // أصول ما قبل هذا التعديل (بلا accountId) تسقط على المسار الاحتياطي القديم فقط.
  const assetAccountId = asset.accountId ?? (await getAccountIdByName(tenantId, asset.companyId, "الأصول الثابتة"));
  const receiveAccountId = await getAccountIdByName(tenantId, asset.companyId, input.method === "cash" ? "النقدية بالصندوق" : "البنك الأهلي - حساب تشغيلي");

  const lines: { accountId: string; fixedAssetId: string; department: string; debit: number; credit: number }[] = [];
  if (accDep > 0) lines.push({ accountId: accDepAccountId, fixedAssetId: asset.id, department: "المالية والحسابات", debit: accDep, credit: 0 });
  if (input.salePrice > 0) lines.push({ accountId: receiveAccountId, fixedAssetId: asset.id, department: "المالية والحسابات", debit: input.salePrice, credit: 0 });
  if (gainLoss > 0) {
    const gainAccountId = await getAccountIdByName(tenantId, asset.companyId, "أرباح استبعاد أصول");
    lines.push({ accountId: gainAccountId, fixedAssetId: asset.id, department: "المالية والحسابات", debit: 0, credit: gainLoss });
  } else if (gainLoss < 0) {
    const lossAccountId = await getAccountIdByName(tenantId, asset.companyId, "خسائر استبعاد أصول");
    lines.push({ accountId: lossAccountId, fixedAssetId: asset.id, department: "المالية والحسابات", debit: -gainLoss, credit: 0 });
  }
  lines.push({ accountId: assetAccountId, fixedAssetId: asset.id, department: "المالية والحسابات", debit: 0, credit: Number(asset.cost) });

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
