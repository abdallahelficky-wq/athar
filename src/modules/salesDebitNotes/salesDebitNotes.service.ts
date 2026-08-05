import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine } from "../../lib/invoiceLine";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
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

interface DebitNoteInput {
  companyId: string;
  customerId: string;
  relatedInvoiceId?: string;
  date: Date;
  reason?: string;
  chargeMethod: "account" | "cash" | "bank";
  lines: LineInput[];
}

const debitNoteInclude = { lines: { include: { account: true } }, customer: true, company: true } as const;

// إشعار مدين = عكس منطق المردود تماماً: يزيد ما يستحق على العميل بدل تخفيضه، لذا نفس أسماء
// الحسابات المرجعية (النقدية/البنك/الذمم) لكن الأثر المحاسبي معكوس (انظر createJournalEntryTx أدناه).
const CHARGE_ACCOUNT_NAME: Record<string, string> = {
  cash: "النقدية بالصندوق",
  bank: "البنك الأهلي - حساب تشغيلي",
  account: "ذمم مدينة",
};

export async function listSalesDebitNotes(tenantId: string, filters: { companyId?: string; customerId?: string }) {
  return prisma.salesDebitNote.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, customerId: filters.customerId || undefined },
    include: debitNoteInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function createSalesDebitNote(tenantId: string, userId: string, input: DebitNoteInput) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: input.companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId: input.companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");

  const computed = input.lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  if (grandTotal <= 0) throw badRequest("إجمالي الإشعار المدين يجب أن يكون أكبر من صفر");

  const vatOutputId = await getAccountIdByName(tenantId, input.companyId, "ضريبة القيمة المضافة - مخرجات");
  const chargeAccountId = await getAccountIdByName(tenantId, input.companyId, CHARGE_ACCOUNT_NAME[input.chargeMethod]);

  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  const journalLines = [
    { accountId: chargeAccountId, department: "المالية والحسابات", debit: grandTotal, credit: 0, customerId: input.customerId },
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: 0, credit: amount, customerId: input.customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: 0, credit: vatTotal, customerId: input.customerId },
  ];

  const count = await prisma.salesDebitNote.count({ where: { tenantId } });
  const debitNoteNumber = formatDocNumber("DBN", count);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: `إشعار مدين ${debitNoteNumber} — ${customer.name}`,
      sourceModule: "sales_debit_note",
      createdBy: userId,
      lines: journalLines,
    });

    const debitNote = await tx.salesDebitNote.create({
      data: {
        tenantId,
        debitNoteNumber,
        companyId: input.companyId,
        customerId: input.customerId,
        relatedInvoiceId: input.relatedInvoiceId,
        reason: input.reason,
        chargeMethod: input.chargeMethod,
        date: input.date,
        status: "posted",
        journalEntryId: entry.id,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      },
      include: debitNoteInclude,
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: debitNote.id } });
    return debitNote;
  });
}

export async function deleteSalesDebitNote(tenantId: string, id: string) {
  const existing = await prisma.salesDebitNote.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الإشعار المدين غير موجود");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف إشعار مدين مرحّل، يجب فك ترحيله أولاً");
  await prisma.salesDebitNote.delete({ where: { id } });
}

export async function postSalesDebitNote(tenantId: string, userId: string, id: string) {
  const debitNote = await prisma.salesDebitNote.findFirst({
    where: { id, tenantId },
    include: { lines: true, customer: true },
  });
  if (!debitNote) throw notFound("الإشعار المدين غير موجود");
  if (debitNote.status === "posted") throw badRequest("الإشعار المدين مرحّل بالفعل");

  const vatOutputId = await getAccountIdByName(tenantId, debitNote.companyId, "ضريبة القيمة المضافة - مخرجات");
  const chargeAccountId = await getAccountIdByName(tenantId, debitNote.companyId, CHARGE_ACCOUNT_NAME[debitNote.chargeMethod || "account"]);
  const byAccount = new Map<string, number>();
  debitNote.lines.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + Number(l.subtotal)));

  const journalLines = [
    { accountId: chargeAccountId, department: "المالية والحسابات", debit: Number(debitNote.grandTotal), credit: 0, customerId: debitNote.customerId },
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: 0, credit: amount, customerId: debitNote.customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: 0, credit: Number(debitNote.vatTotal), customerId: debitNote.customerId },
  ];

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: debitNote.companyId,
      date: debitNote.date,
      memo: `إشعار مدين ${debitNote.debitNoteNumber} — ${debitNote.customer.name}`,
      sourceModule: "sales_debit_note",
      sourceId: debitNote.id,
      createdBy: userId,
      lines: journalLines,
    });
    return tx.salesDebitNote.update({
      where: { id },
      data: { status: "posted", journalEntryId: entry.id },
      include: debitNoteInclude,
    });
  });
}

export async function unpostSalesDebitNote(tenantId: string, userId: string, id: string, pin: string) {
  const debitNote = await prisma.salesDebitNote.findFirst({ where: { id, tenantId } });
  if (!debitNote) throw notFound("الإشعار المدين غير موجود");
  if (debitNote.status !== "posted") throw badRequest("الإشعار المدين ليس مرحّلاً أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, debitNote.journalEntryId);
    const updated = await tx.salesDebitNote.update({
      where: { id },
      data: { status: "draft", journalEntryId: null },
      include: debitNoteInclude,
    });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "SalesDebitNote", entityId: id });
    return updated;
  });
}
