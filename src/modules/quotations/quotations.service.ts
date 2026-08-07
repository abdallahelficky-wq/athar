import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine, invoiceTypeForCustomer } from "../../lib/invoiceLine";
import { buildZatcaQrPayload } from "../../lib/zatcaQr";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { formatDocNumber } from "../../lib/docNumber";
import { sendInvoiceByEmail } from "../salesInvoices/salesInvoiceEmail.service";

interface LineInput {
  accountId: string;
  itemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
  vatApplicable?: boolean;
}

interface QuotationInput {
  companyId: string;
  customerId: string;
  date: Date;
  validUntil?: Date;
  lines: LineInput[];
}

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
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");

  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  if (itemIds.length) {
    const itemCount = await prisma.item.count({ where: { id: { in: itemIds }, tenantId, companyId } });
    if (itemCount !== itemIds.length) throw badRequest("أحد الأصناف المختارة غير موجود ضمن هذه الشركة");
  }
  return customer;
}

export async function listQuotations(tenantId: string, companyId?: string) {
  return prisma.quotation.findMany({
    where: { tenantId, companyId: companyId || undefined },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createQuotation(tenantId: string, input: QuotationInput) {
  await assertRefs(tenantId, input.companyId, input.customerId, input.lines);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);

  const count = await prisma.quotation.count({ where: { tenantId } });
  const quoteNumber = formatDocNumber("QUO", count);

  return prisma.quotation.create({
    data: {
      tenantId,
      quoteNumber,
      companyId: input.companyId,
      customerId: input.customerId,
      date: input.date,
      validUntil: input.validUntil,
      status: "draft",
      lines: computed,
      subtotal,
      vatTotal,
      grandTotal,
    },
  });
}

export async function updateQuotation(tenantId: string, id: string, input: QuotationInput) {
  const existing = await prisma.quotation.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("عرض السعر غير موجود");
  if (existing.status === "converted") throw badRequest("لا يمكن تعديل عرض سعر تم تحويله لفاتورة");

  await assertRefs(tenantId, input.companyId, input.customerId, input.lines);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);

  return prisma.quotation.update({
    where: { id },
    data: {
      companyId: input.companyId,
      customerId: input.customerId,
      date: input.date,
      validUntil: input.validUntil,
      lines: computed,
      subtotal,
      vatTotal,
      grandTotal,
    },
  });
}

export async function deleteQuotation(tenantId: string, id: string) {
  const existing = await prisma.quotation.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("عرض السعر غير موجود");
  if (existing.status === "converted") throw badRequest("لا يمكن حذف عرض سعر تم تحويله لفاتورة");
  await prisma.quotation.delete({ where: { id } });
}

export async function convertQuotationToInvoice(tenantId: string, userId: string, id: string) {
  const quotation = await prisma.quotation.findFirst({ where: { id, tenantId }, include: { customer: true, company: true } });
  if (!quotation) throw notFound("عرض السعر غير موجود");
  if (quotation.status === "converted") throw badRequest("تم تحويل عرض السعر هذا مسبقاً");

  const lines = quotation.lines as unknown as Array<{
    accountId: string; itemId?: string; description?: string; quantity: number; unitPrice: number;
    discountPct: number; priceIncludesVat: boolean; vatApplicable?: boolean; subtotal: number; vat: number; total: number;
  }>;

  const vatOutputId = await getAccountIdByName(tenantId, quotation.companyId, "ضريبة القيمة المضافة - مخرجات");
  const receivableId = await getAccountIdByName(tenantId, quotation.companyId, "ذمم مدينة");

  const byAccount = new Map<string, number>();
  lines.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  const subtotal = Number(quotation.subtotal);
  const vatTotal = Number(quotation.vatTotal);
  const grandTotal = Number(quotation.grandTotal);

  const invoiceCount = await prisma.salesInvoice.count({ where: { tenantId } });
  const invoiceNumber = formatDocNumber("INV", invoiceCount);
  const invType = invoiceTypeForCustomer(quotation.customer);
  const qrPayload = buildZatcaQrPayload(
    quotation.company.name,
    quotation.company.vatNumber || "",
    `${quotation.date.toISOString().slice(0, 10)}T12:00:00`,
    grandTotal,
    vatTotal,
  );

  const createdInvoice = await prisma.$transaction(async (tx) => {
    const journalLines = [
      ...[...byAccount.entries()].map(([accountId, amount]) => ({
        accountId, department: "المبيعات والتسويق", debit: 0, credit: amount, customerId: quotation.customerId,
      })),
      { accountId: vatOutputId, department: "المالية والحسابات", debit: 0, credit: vatTotal, customerId: quotation.customerId },
      { accountId: receivableId, department: "المالية والحسابات", debit: grandTotal, credit: 0, customerId: quotation.customerId },
    ];

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: quotation.companyId,
      date: quotation.date,
      memo: `فاتورة مبيعات ${invoiceNumber} — ${quotation.customer.name} (من عرض سعر ${quotation.quoteNumber})`,
      sourceModule: "sales_invoice",
      createdBy: userId,
      lines: journalLines,
    });

    const invoice = await tx.salesInvoice.create({
      data: {
        tenantId,
        invoiceNumber,
        companyId: quotation.companyId,
        customerId: quotation.customerId,
        date: quotation.date,
        invoiceType: invType,
        status: "posted",
        journalEntryId: entry.id,
        qrPayload,
        subtotal,
        vatTotal,
        grandTotal,
        // itemId فارغ (سلسلة نصية "") يُطبَّع إلى undefined دفاعياً — يحمي من أي بيانات قديمة
        // خُزِّنت قبل إضافة تطبيع itemId في quotations.schemas.ts، ومن انتهاك قيد FK عند الإنشاء.
        lines: { create: lines.map((l) => ({ ...l, itemId: l.itemId || undefined })) },
      },
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: invoice.id } });
    await tx.quotation.update({ where: { id: quotation.id }, data: { status: "converted", convertedInvoiceId: invoice.id } });

    return invoice;
  });

  // نفس منطق الإرسال التلقائي عند ترحيل فاتورة مبيعات عادية — تحويل عرض سعر ينتج فاتورة
  // مُرحَّلة فعلياً بالفعل فيستحق نفس المعاملة.
  const emailResult = await sendInvoiceByEmail(tenantId, createdInvoice.id, { method: "auto" });
  return { ...createdInvoice, emailResult };
}
