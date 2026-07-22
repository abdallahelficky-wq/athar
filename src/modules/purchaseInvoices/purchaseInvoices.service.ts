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

interface InvoiceInput {
  companyId: string;
  supplierId: string;
  date: Date;
  lines: LineInput[];
}

const invoiceInclude = { lines: { include: { account: true } }, supplier: true, company: true } as const;

function computeLines(lines: LineInput[]) {
  const computed = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  return { computed, subtotal, vatTotal, grandTotal };
}

async function assertRefs(tenantId: string, companyId: string, supplierId: string, lines: LineInput[]) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId, companyId } });
  if (!supplier) throw badRequest("المورد غير موجود ضمن هذه الشركة");

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, tenantId } });
  if (accounts.length !== accountIds.length) throw badRequest("أحد الحسابات المختارة غير موجود ضمن شجرة حساباتك");
  return supplier;
}

async function buildJournalLines(supplierId: string, computed: Array<{ accountId: string; subtotal: number }>, vatTotal: number, grandTotal: number, tenantId: string) {
  const vatInputId = await getAccountIdByName(tenantId, "ضريبة القيمة المضافة - مدخلات");
  const payableId = await getAccountIdByName(tenantId, "ذمم دائنة - موردين");
  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  return [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المشتريات", debit: amount, credit: 0, supplierId,
    })),
    { accountId: vatInputId, department: "المالية والحسابات", debit: vatTotal, credit: 0, supplierId },
    { accountId: payableId, department: "المالية والحسابات", debit: 0, credit: grandTotal, supplierId },
  ];
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
  const supplier = await assertRefs(tenantId, input.companyId, input.supplierId, input.lines);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");

  const count = await prisma.purchaseInvoice.count({ where: { tenantId } });
  const invoiceNumber = formatDocNumber("PINV", count);
  const journalLines = await buildJournalLines(input.supplierId, computed, vatTotal, grandTotal, tenantId);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: `فاتورة مشتريات ${invoiceNumber} — ${supplier.name}`,
      sourceModule: "purchase_invoice",
      createdBy: userId,
      lines: journalLines,
    });

    const invoice = await tx.purchaseInvoice.create({
      data: {
        tenantId,
        invoiceNumber,
        companyId: input.companyId,
        supplierId: input.supplierId,
        date: input.date,
        status: "posted",
        journalEntryId: entry.id,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      },
      include: invoiceInclude,
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: invoice.id } });
    return invoice;
  });
}

export async function updatePurchaseInvoice(tenantId: string, id: string, input: InvoiceInput) {
  const existing = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن تعديل فاتورة مرحّلة، يجب فك ترحيلها أولاً");

  await assertRefs(tenantId, input.companyId, input.supplierId, input.lines);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");

  return prisma.$transaction(async (tx) => {
    await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId: id } });
    return tx.purchaseInvoice.update({
      where: { id },
      data: { companyId: input.companyId, supplierId: input.supplierId, date: input.date, subtotal, vatTotal, grandTotal, lines: { create: computed } },
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
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId }, include: { lines: true, supplier: true } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status === "posted") throw badRequest("الفاتورة مرحّلة بالفعل");

  const computed = invoice.lines.map((l) => ({ accountId: l.accountId, subtotal: Number(l.subtotal) }));
  const journalLines = await buildJournalLines(invoice.supplierId, computed, Number(invoice.vatTotal), Number(invoice.grandTotal), tenantId);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: invoice.companyId,
      date: invoice.date,
      memo: `فاتورة مشتريات ${invoice.invoiceNumber} — ${invoice.supplier.name}`,
      sourceModule: "purchase_invoice",
      sourceId: invoice.id,
      createdBy: userId,
      lines: journalLines,
    });
    return tx.purchaseInvoice.update({ where: { id }, data: { status: "posted", journalEntryId: entry.id }, include: invoiceInclude });
  });
}

export async function unpostPurchaseInvoice(tenantId: string, userId: string, id: string, pin: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("الفاتورة ليست مرحّلة أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, invoice.journalEntryId);
    const updated = await tx.purchaseInvoice.update({ where: { id }, data: { status: "draft", journalEntryId: null }, include: invoiceInclude });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "PurchaseInvoice", entityId: id });
    return updated;
  });
}
