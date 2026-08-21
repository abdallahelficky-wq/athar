import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine } from "../../lib/invoiceLine";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx, PostingLine } from "../../lib/journalPosting";
import { formatDocNumber } from "../../lib/docNumber";
import { applyPurchaseToAverageCostTx, recomputeAverageCostFromScratchTx } from "../../lib/costingEngine";
import { registerFixedAssetTx, resolveAssetAccount } from "../fixedAssets/fixedAssets.service";

type Tx = Prisma.TransactionClient;

interface LineInput {
  accountId: string;
  itemId?: string;
  warehouseId?: string;
  usefulLifeYears?: number;
  salvageValue?: number;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
  // يُشتَق داخلياً في resolveLineAccounts فقط (لا يُقرَأ من طلب العميل) — يُبقي سطر الأصل الثابت
  // منفصلاً وغير مُجمَّع مع أسطر أخرى تشارك نفس الحساب عند بناء سطور القيد، فيمكن ربط كل سطر قيد
  // بسجل الأصل الناتج عنه تحديداً (fixedAssetId) بدل تجميعهما في سطر واحد يفقد هذا الربط.
  isFixedAssetLine?: boolean;
}

interface InvoiceInput {
  companyId: string;
  supplierId: string;
  branchId?: string | null;
  date: Date;
  lines: LineInput[];
}

const invoiceInclude = { lines: { include: { account: true, item: true, warehouse: true } }, supplier: true, company: true, branch: true } as const;

function computeLines(lines: LineInput[]) {
  const computed = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  return { computed, subtotal, vatTotal, grandTotal };
}

/**
 * الحساب المحاسبي المرتبط بكل صنف يُحدَّد من شاشة الصنف نفسها لا من الفاتورة — أي قيمة
 * accountId يرسلها العميل لسطر مرتبط بصنف تُتجاهَل وتُستبدَل بالحساب المشتق من نوع الصنف.
 * الأسطر بلا itemId (مصاريف متفرقة حرة) تحتفظ بالـ accountId اليدوي كما هو.
 */
async function resolveLineAccounts(tenantId: string, companyId: string, lines: LineInput[]): Promise<LineInput[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } }) : [];
  if (items.length !== itemIds.length) throw badRequest("أحد الأصناف المختارة غير موجود ضمن هذه الشركة");
  const itemById = new Map(items.map((i) => [i.id, i]));

  // لازم يتحقق من أن المستودع المُختار ينتمي فعلاً لهذه الشركة (لا يكفي وجود المعرّف فقط)،
  // وإلا يمكن لطلب مباشر عبر الـ API إرسال معرّف مستودع شركة أخرى فتُسجَّل حركة المخزون على
  // مستودع لا يخصّها وتُفسِد رصيده.
  const warehouseIds = [...new Set(lines.map((l) => l.warehouseId).filter((x): x is string => Boolean(x)))];
  const warehouses = warehouseIds.length ? await prisma.warehouse.findMany({ where: { id: { in: warehouseIds }, tenantId, companyId } }) : [];
  if (warehouses.length !== warehouseIds.length) throw badRequest("أحد المستودعات المختارة غير موجود ضمن هذه الشركة");
  const warehouseIdSet = new Set(warehouses.map((w) => w.id));

  const resolved: LineInput[] = [];
  for (const line of lines) {
    if (!line.itemId) {
      resolved.push(line);
      continue;
    }
    const item = itemById.get(line.itemId)!;
    if (item.type === "service") throw badRequest(`الصنف "${item.name}" من نوع خدمي، لا يمكن شراؤه`);
    if (item.type === "bundle") throw badRequest(`الصنف "${item.name}" منتج مجمّع — رصيده يزيد فقط عبر أمر تصنيع، لا الشراء المباشر`);

    if (item.type === "fixed_asset") {
      if (!line.usefulLifeYears || line.salvageValue == null) throw badRequest(`أدخل العمر الإنتاجي وقيمة الخردة للصنف "${item.name}"`);
      if (!item.assetCategoryId) throw badRequest(`حدّد فئة الأصل للصنف "${item.name}" من شاشة الأصناف أولاً`);
      const { accountId } = await resolveAssetAccount(prisma, tenantId, companyId, { categoryId: item.assetCategoryId });
      resolved.push({ ...line, accountId, isFixedAssetLine: true });
      continue;
    }

    if (!line.warehouseId || !warehouseIdSet.has(line.warehouseId)) throw badRequest(`اختر مستودعاً صالحاً ضمن هذه الشركة للصنف "${item.name}"`);
    const primaryAccountId = item.type === "expense" ? item.expenseAccountId : item.stockAccountId;
    if (!primaryAccountId) throw badRequest(`لم يُحدَّد الحساب المحاسبي المرتبط بالصنف "${item.name}" بعد؛ أكمل بياناته من شاشة الأصناف أولاً`);
    resolved.push({ ...line, accountId: primaryAccountId });
  }
  return resolved;
}

async function assertRefs(tenantId: string, companyId: string, supplierId: string, lines: LineInput[], branchId?: string | null) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId, companyId } });
  if (!supplier) throw badRequest("المورد غير موجود ضمن هذه الشركة");
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId, companyId } });
    if (!branch) throw badRequest("الفرع المحدد غير موجود ضمن هذه الشركة");
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId, isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد الحسابات المختارة غير موجود ضمن شجرة حساباتك");
  return supplier;
}

/**
 * ينشئ حركة المخزون/سجل الأصل الثابت المرتبط بكل سطر فاتورة مرتبط بصنف — يُستدعى بعد حفظ سطور
 * الفاتورة فعلياً (لأنه يحتاج line.id). لأسطر الأصول الثابتة تحديداً (Phase G): ينشئ سطر القيد
 * الخاص بهذا السطر بمفرده أولاً (assetLines مصفوفة موازية بنفس ترتيب أسطر الأصول الثابتة ضمن
 * persistedLines، جهّزها buildJournalLines بلا تجميع مع أسطر أخرى)، ثم يسجّل الأصل عبر
 * registerFixedAssetTx بفئته (categoryId) لا بحساب خام، ثم يربط سطر القيد بسجل الأصل الناتج
 * (fixedAssetId) — فيظهر رابط الأصل عند عرض قيد الفاتورة تماماً كما يظهر لأصل مسجَّل من سطر قيد
 * يومية عام (Phase F).
 */
async function createInventorySideEffectsTx(
  tx: Tx,
  tenantId: string,
  companyId: string,
  date: Date,
  persistedLines: Array<{
    id: string; itemId: string | null; warehouseId: string | null; accountId: string;
    usefulLifeYears: number | null; salvageValue: Prisma.Decimal | null; quantity: Prisma.Decimal; subtotal: Prisma.Decimal; description: string | null;
  }>,
  journalEntryId: string,
  assetLines: PostingLine[],
) {
  let assetLineIdx = 0;
  for (const line of persistedLines) {
    if (!line.itemId) continue;
    const item = await tx.item.findFirstOrThrow({ where: { id: line.itemId, tenantId } });

    if (item.type === "fixed_asset") {
      const spec = assetLines[assetLineIdx++];
      const journalLine = await tx.journalEntryLine.create({
        data: {
          journalEntryId,
          accountId: spec.accountId,
          department: spec.department || null,
          debit: new Prisma.Decimal(spec.debit || 0),
          credit: new Prisma.Decimal(spec.credit || 0),
          supplierId: spec.supplierId || null,
        },
      });
      const { asset } = await registerFixedAssetTx(tx, tenantId, {
        companyId, categoryId: item.assetCategoryId!,
        name: line.description || item.name,
        purchaseDate: date, cost: Number(line.subtotal), usefulLifeYears: line.usefulLifeYears!, salvageValue: Number(line.salvageValue ?? 0),
        journalEntryId, sourcePurchaseInvoiceLineId: line.id,
      });
      await tx.journalEntryLine.update({ where: { id: journalLine.id }, data: { fixedAssetId: asset.id } });
      continue;
    }

    const quantity = Number(line.quantity);
    const unitCost = quantity > 0 ? Number(line.subtotal) / quantity : 0;
    // متوسط التكلفة *قبل* تسجيل حركة "الوارد" نفسها (وإلا تُحتسَب هذه الحركة ضمن الرصيد
    // القديم فتُضاعِف تأثيرها في المعادلة)
    if (item.type !== "expense") await applyPurchaseToAverageCostTx(tx, tenantId, item.id, quantity, unitCost);
    await tx.stockMovement.create({
      data: {
        tenantId, companyId, itemId: item.id, warehouseId: line.warehouseId!, type: "in",
        quantity, unitCost, date, journalEntryId, sourcePurchaseInvoiceLineId: line.id,
      },
    });
  }
}

/** يُستدعى عند فك ترحيل الفاتورة — يحذف كل حركة مخزون/أصل ثابت أُنشئ تلقائياً من أسطرها. */
async function removeInventorySideEffectsTx(tx: Tx, tenantId: string, invoiceId: string) {
  const lines = await tx.purchaseInvoiceLine.findMany({ where: { invoiceId }, select: { id: true, itemId: true } });
  const lineIds = lines.map((l) => l.id);
  if (!lineIds.length) return;
  await tx.stockMovement.deleteMany({ where: { sourcePurchaseInvoiceLineId: { in: lineIds } } });
  await tx.fixedAsset.deleteMany({ where: { sourcePurchaseInvoiceLineId: { in: lineIds } } });
  // كل سطر شراء مرتبط بصنف كان يحدّث averageCost عند الترحيل (createInventorySideEffectsTx) —
  // يجب إعادة حسابها من الصفر بعد حذف حركة الوارد المقابلة، وإلا يفضل المتوسط محسوباً على
  // كمية لم تعد موجودة فعلياً في المخزون.
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  for (const itemId of itemIds) await recomputeAverageCostFromScratchTx(tx, tenantId, itemId);
}

/**
 * يبني سطور قيد الفاتورة — الأسطر غير المرتبطة بأصول ثابتة تبقى مُجمَّعة حسب الحساب كما كان
 * (groupedLines، تُمرَّر مباشرة لـ createJournalEntryTx). أسطر الأصول الثابتة تُفصَل ولا تُجمَّع
 * حتى لو شاركت نفس الحساب (assetLines) لأن كل سطر منها سيُربَط لاحقاً بسجل أصل مختلف — تجميعها
 * يفقد إمكانية الربط سطراً بسطر (createInventorySideEffectsTx).
 */
async function buildJournalLines(
  supplier: { id: string; accountId: string | null },
  computed: Array<{ accountId: string; subtotal: number; isFixedAssetLine?: boolean }>,
  vatTotal: number,
  grandTotal: number,
  tenantId: string,
  companyId: string,
): Promise<{ groupedLines: PostingLine[]; assetLines: PostingLine[] }> {
  const supplierId = supplier.id;
  const vatInputId = await getAccountIdByName(tenantId, companyId, "ضريبة القيمة المضافة - مدخلات");
  const payableId = await resolvePartyAccountId(tenantId, companyId, supplier, "ذمم دائنة - موردين");

  const otherComputed = computed.filter((l) => !l.isFixedAssetLine);
  const assetComputed = computed.filter((l) => l.isFixedAssetLine);
  const byAccount = new Map<string, number>();
  otherComputed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  const groupedLines: PostingLine[] = [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المشتريات", debit: amount, credit: 0, supplierId,
    })),
    { accountId: vatInputId, department: "المالية والحسابات", debit: vatTotal, credit: 0, supplierId },
    { accountId: payableId, department: "المالية والحسابات", debit: 0, credit: grandTotal, supplierId },
  ];
  const assetLines: PostingLine[] = assetComputed.map((l) => ({
    accountId: l.accountId, department: "المشتريات", debit: l.subtotal, credit: 0, supplierId,
  }));

  return { groupedLines, assetLines };
}

export async function listPurchaseInvoices(tenantId: string, filters: { companyId?: string; supplierId?: string }) {
  return prisma.purchaseInvoice.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, supplierId: filters.supplierId || undefined },
    include: invoiceInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getPurchaseInvoice(tenantId: string, id: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  return invoice;
}

export async function createPurchaseInvoice(tenantId: string, userId: string, input: InvoiceInput) {
  const resolvedLines = await resolveLineAccounts(tenantId, input.companyId, input.lines);
  const supplier = await assertRefs(tenantId, input.companyId, input.supplierId, resolvedLines, input.branchId);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(resolvedLines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");

  const count = await prisma.purchaseInvoice.count({ where: { tenantId } });
  const invoiceNumber = formatDocNumber("PINV", count);
  const { groupedLines, assetLines } = await buildJournalLines(supplier, computed, vatTotal, grandTotal, tenantId, input.companyId);
  const persistableLines = computed.map(({ isFixedAssetLine, ...rest }) => rest);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      branchId: input.branchId || undefined,
      date: input.date,
      memo: `فاتورة مشتريات ${invoiceNumber} — ${supplier.name}`,
      sourceModule: "purchase_invoice",
      createdBy: userId,
      lines: groupedLines,
    });

    const invoice = await tx.purchaseInvoice.create({
      data: {
        tenantId,
        invoiceNumber,
        companyId: input.companyId,
        supplierId: input.supplierId,
        branchId: input.branchId || undefined,
        date: input.date,
        status: "posted",
        journalEntryId: entry.id,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: persistableLines },
      },
      include: invoiceInclude,
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: invoice.id } });
    await createInventorySideEffectsTx(tx, tenantId, input.companyId, input.date, invoice.lines, entry.id, assetLines);
    return invoice;
  });
}

export async function updatePurchaseInvoice(tenantId: string, id: string, input: InvoiceInput) {
  const existing = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن تعديل فاتورة مرحّلة، يجب فك ترحيلها أولاً");

  const resolvedLines = await resolveLineAccounts(tenantId, input.companyId, input.lines);
  await assertRefs(tenantId, input.companyId, input.supplierId, resolvedLines, input.branchId);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(resolvedLines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");
  const persistableLines = computed.map(({ isFixedAssetLine, ...rest }) => rest);

  return prisma.$transaction(async (tx) => {
    await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId: id } });
    return tx.purchaseInvoice.update({
      where: { id },
      data: { companyId: input.companyId, supplierId: input.supplierId, branchId: input.branchId ?? null, date: input.date, subtotal, vatTotal, grandTotal, lines: { create: persistableLines } },
      include: invoiceInclude,
    });
  });
}

export async function deletePurchaseInvoice(tenantId: string, id: string) {
  const existing = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف فاتورة مرحّلة، يجب فك ترحيلها أولاً");
  await prisma.purchaseInvoice.delete({ where: { id } });
}

export async function postPurchaseInvoice(tenantId: string, userId: string, id: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId }, include: { lines: { include: { item: true } }, supplier: true } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status === "posted") throw badRequest("الفاتورة مرحّلة بالفعل");

  const computed = invoice.lines.map((l) => ({ accountId: l.accountId, subtotal: Number(l.subtotal), isFixedAssetLine: l.item?.type === "fixed_asset" }));
  const { groupedLines, assetLines } = await buildJournalLines(invoice.supplier, computed, Number(invoice.vatTotal), Number(invoice.grandTotal), tenantId, invoice.companyId);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
      date: invoice.date,
      memo: `فاتورة مشتريات ${invoice.invoiceNumber} — ${invoice.supplier.name}`,
      sourceModule: "purchase_invoice",
      sourceId: invoice.id,
      createdBy: userId,
      lines: groupedLines,
    });
    const updated = await tx.purchaseInvoice.update({ where: { id }, data: { status: "posted", journalEntryId: entry.id }, include: invoiceInclude });
    await createInventorySideEffectsTx(tx, tenantId, invoice.companyId, invoice.date, invoice.lines, entry.id, assetLines);
    return updated;
  });
}

export async function unpostPurchaseInvoice(tenantId: string, userId: string, id: string, pin: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("الفاتورة ليست مرحّلة أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await removeInventorySideEffectsTx(tx, tenantId, id);
    await deleteJournalEntryTx(tx, invoice.journalEntryId);
    const updated = await tx.purchaseInvoice.update({ where: { id }, data: { status: "draft", journalEntryId: null }, include: invoiceInclude });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "PurchaseInvoice", entityId: id });
    return updated;
  });
}
