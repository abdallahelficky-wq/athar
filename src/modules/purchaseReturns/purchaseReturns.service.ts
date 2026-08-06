import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine } from "../../lib/invoiceLine";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { formatDocNumber } from "../../lib/docNumber";

interface LineInput {
  accountId: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
}

interface ReturnInput {
  companyId: string;
  supplierId: string;
  relatedInvoiceId?: string;
  date: Date;
  reason?: string;
  lines: LineInput[];
}

const returnInclude = { lines: { include: { account: true } }, supplier: true } as const;

async function buildJournalLines(supplier: { id: string; accountId: string | null }, computed: Array<{ accountId: string; subtotal: number }>, vatTotal: number, grandTotal: number, tenantId: string, companyId: string) {
  const supplierId = supplier.id;
  const vatInputId = await getAccountIdByName(tenantId, companyId, "ضريبة القيمة المضافة - مدخلات");
  const payableId = await resolvePartyAccountId(tenantId, companyId, supplier, "ذمم دائنة - موردين");
  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  return [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المشتريات", debit: 0, credit: amount, supplierId,
    })),
    { accountId: vatInputId, department: "المالية والحسابات", debit: 0, credit: vatTotal, supplierId },
    { accountId: payableId, department: "المالية والحسابات", debit: grandTotal, credit: 0, supplierId },
  ];
}

export async function listPurchaseReturns(tenantId: string, filters: { companyId?: string; supplierId?: string }) {
  return prisma.purchaseReturn.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, supplierId: filters.supplierId || undefined },
    include: returnInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function createPurchaseReturn(tenantId: string, userId: string, input: ReturnInput) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId, companyId: input.companyId } });
  if (!supplier) throw badRequest("المورد غير موجود ضمن هذه الشركة");

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId: input.companyId, isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد الحسابات المختارة غير موجود ضمن شجرة حساباتك");

  const computed = input.lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  if (grandTotal <= 0) throw badRequest("إجمالي المردود يجب أن يكون أكبر من صفر");

  const journalLines = await buildJournalLines(supplier, computed, vatTotal, grandTotal, tenantId, input.companyId);
  const count = await prisma.purchaseReturn.count({ where: { tenantId } });
  const returnNumber = formatDocNumber("PRET", count);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: `مردود مشتريات ${returnNumber} — ${supplier.name}`,
      sourceModule: "purchase_return",
      createdBy: userId,
      lines: journalLines,
    });

    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        tenantId,
        returnNumber,
        companyId: input.companyId,
        supplierId: input.supplierId,
        relatedInvoiceId: input.relatedInvoiceId,
        reason: input.reason,
        date: input.date,
        status: "posted",
        journalEntryId: entry.id,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      },
      include: returnInclude,
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: purchaseReturn.id } });
    return purchaseReturn;
  });
}

export async function deletePurchaseReturn(tenantId: string, id: string) {
  const existing = await prisma.purchaseReturn.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("المردود غير موجود");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف مردود مرحّل، يجب فك ترحيله أولاً");
  await prisma.purchaseReturn.delete({ where: { id } });
}

export async function postPurchaseReturn(tenantId: string, userId: string, id: string) {
  const purchaseReturn = await prisma.purchaseReturn.findFirst({ where: { id, tenantId }, include: { lines: true, supplier: true } });
  if (!purchaseReturn) throw notFound("المردود غير موجود");
  if (purchaseReturn.status === "posted") throw badRequest("المردود مرحّل بالفعل");

  const computed = purchaseReturn.lines.map((l) => ({ accountId: l.accountId, subtotal: Number(l.subtotal) }));
  const journalLines = await buildJournalLines(purchaseReturn.supplier, computed, Number(purchaseReturn.vatTotal), Number(purchaseReturn.grandTotal), tenantId, purchaseReturn.companyId);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: purchaseReturn.companyId,
      date: purchaseReturn.date,
      memo: `مردود مشتريات ${purchaseReturn.returnNumber} — ${purchaseReturn.supplier.name}`,
      sourceModule: "purchase_return",
      sourceId: purchaseReturn.id,
      createdBy: userId,
      lines: journalLines,
    });
    return tx.purchaseReturn.update({ where: { id }, data: { status: "posted", journalEntryId: entry.id }, include: returnInclude });
  });
}

export async function unpostPurchaseReturn(tenantId: string, userId: string, id: string, pin: string) {
  const purchaseReturn = await prisma.purchaseReturn.findFirst({ where: { id, tenantId } });
  if (!purchaseReturn) throw notFound("المردود غير موجود");
  if (purchaseReturn.status !== "posted") throw badRequest("المردود ليس مرحّلاً أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, purchaseReturn.journalEntryId);
    const updated = await tx.purchaseReturn.update({ where: { id }, data: { status: "draft", journalEntryId: null }, include: returnInclude });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "PurchaseReturn", entityId: id });
    return updated;
  });
}
