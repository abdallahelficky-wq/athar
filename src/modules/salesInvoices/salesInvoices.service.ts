import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine, invoiceTypeForCustomer } from "../../lib/invoiceLine";
import { buildZatcaQrPayload } from "../../lib/zatcaQr";
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
  customerId: string;
  date: Date;
  lines: LineInput[];
}

const invoiceInclude = {
  lines: { include: { account: true } },
  customer: true,
  company: true,
  receiptAllocations: true,
} as const;

function computeLines(lines: LineInput[]) {
  const computed = lines.map((l) => ({ ...l, ...computeInvoiceLine(l) }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  return { computed, subtotal, vatTotal, grandTotal };
}

async function assertRefs(tenantId: string, companyId: string, customerId: string, lines: LineInput[]) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId, companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, tenantId, type: "revenue" } });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");
  return { company, customer };
}

function paidAmountOf(invoice: { receiptAllocations: { amount: unknown }[] }) {
  return invoice.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
}

function paymentStatusOf(grandTotal: number, paid: number) {
  if (paid >= grandTotal - 0.5) return "مسددة";
  if (paid > 0) return "مسددة جزئياً";
  return "غير مسددة";
}

function withPaymentStatus<T extends { grandTotal: unknown; receiptAllocations: { amount: unknown }[] }>(invoice: T) {
  const paid = paidAmountOf(invoice);
  return { ...invoice, paidAmount: paid, paymentStatus: paymentStatusOf(Number(invoice.grandTotal), paid) };
}

export async function listSalesInvoices(tenantId: string, filters: { companyId?: string; customerId?: string }) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, customerId: filters.customerId || undefined },
    include: invoiceInclude,
    orderBy: { createdAt: "desc" },
  });
  return invoices.map(withPaymentStatus);
}

export async function getSalesInvoice(tenantId: string, id: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  return withPaymentStatus(invoice);
}

async function buildJournalLines(tenantId: string, customerId: string, computed: Array<LineInput & { subtotal: number; vat: number; total: number }>, vatTotal: number, grandTotal: number) {
  const vatOutputId = await getAccountIdByName(tenantId, "ضريبة القيمة المضافة - مخرجات");
  const receivableId = await getAccountIdByName(tenantId, "ذمم مدينة");
  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  return [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: 0, credit: amount, customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: 0, credit: vatTotal, customerId },
    { accountId: receivableId, department: "المالية والحسابات", debit: grandTotal, credit: 0, customerId },
  ];
}

export async function createSalesInvoice(tenantId: string, userId: string, input: InvoiceInput) {
  const { customer, company } = await assertRefs(tenantId, input.companyId, input.customerId, input.lines);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");

  const count = await prisma.salesInvoice.count({ where: { tenantId } });
  const invoiceNumber = formatDocNumber("INV", count);
  const invType = invoiceTypeForCustomer(customer);
  const qrPayload = buildZatcaQrPayload(
    company.name,
    company.vatNumber || "",
    `${input.date.toISOString().slice(0, 10)}T12:00:00`,
    grandTotal,
    vatTotal,
  );

  const journalLines = await buildJournalLines(tenantId, input.customerId, computed, vatTotal, grandTotal);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: `فاتورة مبيعات ${invoiceNumber} — ${customer.name}`,
      sourceModule: "sales_invoice",
      createdBy: userId,
      lines: journalLines,
    });

    const invoice = await tx.salesInvoice.create({
      data: {
        tenantId,
        invoiceNumber,
        companyId: input.companyId,
        customerId: input.customerId,
        date: input.date,
        invoiceType: invType,
        status: "posted",
        journalEntryId: entry.id,
        qrPayload,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      },
      include: invoiceInclude,
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: invoice.id } });
    return withPaymentStatus(invoice);
  });
}

export async function updateSalesInvoice(tenantId: string, id: string, input: InvoiceInput) {
  const existing = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن تعديل فاتورة مرحّلة، يجب فك ترحيلها أولاً");

  const { customer } = await assertRefs(tenantId, input.companyId, input.customerId, input.lines);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");
  const invType = invoiceTypeForCustomer(customer);

  return prisma.$transaction(async (tx) => {
    await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
    const invoice = await tx.salesInvoice.update({
      where: { id },
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        date: input.date,
        invoiceType: invType,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      },
      include: invoiceInclude,
    });
    return withPaymentStatus(invoice);
  });
}

export async function deleteSalesInvoice(tenantId: string, id: string) {
  const existing = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف فاتورة مرحّلة، يجب فك ترحيلها أولاً");
  await prisma.salesInvoice.delete({ where: { id } });
}

export async function postSalesInvoice(tenantId: string, userId: string, id: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: { lines: true, customer: true } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status === "posted") throw badRequest("الفاتورة مرحّلة بالفعل");

  const computed = invoice.lines.map((l) => ({
    accountId: l.accountId, subtotal: Number(l.subtotal), vat: Number(l.vat), total: Number(l.total),
    quantity: Number(l.quantity), unitPrice: Number(l.unitPrice),
  }));
  const journalLines = await buildJournalLines(tenantId, invoice.customerId, computed, Number(invoice.vatTotal), Number(invoice.grandTotal));

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: invoice.companyId,
      date: invoice.date,
      memo: `فاتورة مبيعات ${invoice.invoiceNumber} — ${invoice.customer.name}`,
      sourceModule: "sales_invoice",
      sourceId: invoice.id,
      createdBy: userId,
      lines: journalLines,
    });
    const updated = await tx.salesInvoice.update({
      where: { id },
      data: { status: "posted", journalEntryId: entry.id },
      include: invoiceInclude,
    });
    return withPaymentStatus(updated);
  });
}

export async function unpostSalesInvoice(tenantId: string, userId: string, id: string, pin: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("الفاتورة ليست مرحّلة أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, invoice.journalEntryId);
    const updated = await tx.salesInvoice.update({
      where: { id },
      data: { status: "draft", journalEntryId: null },
      include: invoiceInclude,
    });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "SalesInvoice", entityId: id });
    return withPaymentStatus(updated);
  });
}
