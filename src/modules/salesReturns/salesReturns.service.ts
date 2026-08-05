import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine } from "../../lib/invoiceLine";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { formatDocNumber } from "../../lib/docNumber";
import { reserveZatcaChain } from "../../lib/zatca/chain";

/**
 * إشعار دائن (SalesReturn) مرتبط بزاتكا يتطلب رقم الفاتورة الأصلية (BillingReference) — لا نُصدر
 * ICV/تجزئة لمردود بلا فاتورة مرتبطة محدَّدة (relatedInvoiceId فارغ)، فيبقى الحقل "غير منطبق"
 * حتى تُربط لاحقاً؛ هذا لا يمنع الاستخدام المحاسبي العادي للمردود إطلاقاً.
 */
async function resolveBillingReferenceNumber(tenantId: string, relatedInvoiceId: string | null | undefined): Promise<string | undefined> {
  if (!relatedInvoiceId) return undefined;
  const relatedInvoice = await prisma.salesInvoice.findFirst({ where: { id: relatedInvoiceId, tenantId }, select: { invoiceNumber: true } });
  return relatedInvoice?.invoiceNumber;
}

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
  customerId: string;
  relatedInvoiceId?: string;
  date: Date;
  reason?: string;
  refundMethod: "account" | "cash" | "bank";
  lines: LineInput[];
}

const returnInclude = { lines: { include: { account: true } }, customer: true, company: true } as const;

const REFUND_ACCOUNT_NAME: Record<string, string> = {
  cash: "النقدية بالصندوق",
  bank: "البنك الأهلي - حساب تشغيلي",
  account: "ذمم مدينة",
};

export async function listSalesReturns(tenantId: string, filters: { companyId?: string; customerId?: string }) {
  return prisma.salesReturn.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, customerId: filters.customerId || undefined },
    include: returnInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function createSalesReturn(tenantId: string, userId: string, input: ReturnInput) {
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
  if (grandTotal <= 0) throw badRequest("إجمالي المردود يجب أن يكون أكبر من صفر");

  const vatOutputId = await getAccountIdByName(tenantId, input.companyId, "ضريبة القيمة المضافة - مخرجات");
  const creditAccountId = await getAccountIdByName(tenantId, input.companyId, REFUND_ACCOUNT_NAME[input.refundMethod]);

  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  const journalLines = [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: amount, credit: 0, customerId: input.customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: vatTotal, credit: 0, customerId: input.customerId },
    { accountId: creditAccountId, department: "المالية والحسابات", debit: 0, credit: grandTotal, customerId: input.customerId },
  ];

  const count = await prisma.salesReturn.count({ where: { tenantId } });
  const returnNumber = formatDocNumber("RET", count);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: `مردود مبيعات ${returnNumber} — ${customer.name}`,
      sourceModule: "sales_return",
      createdBy: userId,
      lines: journalLines,
    });

    const salesReturn = await tx.salesReturn.create({
      data: {
        tenantId,
        returnNumber,
        companyId: input.companyId,
        customerId: input.customerId,
        relatedInvoiceId: input.relatedInvoiceId,
        reason: input.reason,
        refundMethod: input.refundMethod,
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

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: salesReturn.id } });

    const billingReferenceId = await resolveBillingReferenceNumber(tenantId, input.relatedInvoiceId);
    const chain = billingReferenceId
      ? await reserveZatcaChain(tx, {
          company, customer, kind: "credit_note", documentNumber: returnNumber, documentUuid: salesReturn.zatcaUuid, billingReferenceId, lines: salesReturn.lines,
        })
      : null;
    if (!chain) return salesReturn;

    return tx.salesReturn.update({
      where: { id: salesReturn.id },
      data: {
        icv: chain.icv, previousInvoiceHash: chain.previousInvoiceHash, invoiceHash: chain.invoiceHash,
        zatcaStatus: chain.zatcaStatus, zatcaSubmittedAt: chain.issuedAt,
      },
      include: returnInclude,
    });
  });
}

export async function deleteSalesReturn(tenantId: string, id: string) {
  const existing = await prisma.salesReturn.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("المردود غير موجود");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف مردود مرحّل، يجب فك ترحيله أولاً");
  await prisma.salesReturn.delete({ where: { id } });
}

export async function postSalesReturn(tenantId: string, userId: string, id: string) {
  const salesReturn = await prisma.salesReturn.findFirst({
    where: { id, tenantId },
    include: { lines: true, customer: true },
  });
  if (!salesReturn) throw notFound("المردود غير موجود");
  if (salesReturn.status === "posted") throw badRequest("المردود مرحّل بالفعل");
  const company = await prisma.company.findFirstOrThrow({ where: { id: salesReturn.companyId, tenantId } });

  const vatOutputId = await getAccountIdByName(tenantId, salesReturn.companyId, "ضريبة القيمة المضافة - مخرجات");
  const creditAccountId = await getAccountIdByName(tenantId, salesReturn.companyId, REFUND_ACCOUNT_NAME[salesReturn.refundMethod || "account"]);
  const byAccount = new Map<string, number>();
  salesReturn.lines.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + Number(l.subtotal)));

  const journalLines = [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: amount, credit: 0, customerId: salesReturn.customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: Number(salesReturn.vatTotal), credit: 0, customerId: salesReturn.customerId },
    { accountId: creditAccountId, department: "المالية والحسابات", debit: 0, credit: Number(salesReturn.grandTotal), customerId: salesReturn.customerId },
  ];

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: salesReturn.companyId,
      date: salesReturn.date,
      memo: `مردود مبيعات ${salesReturn.returnNumber} — ${salesReturn.customer.name}`,
      sourceModule: "sales_return",
      sourceId: salesReturn.id,
      createdBy: userId,
      lines: journalLines,
    });
    const updated = await tx.salesReturn.update({
      where: { id },
      data: { status: "posted", journalEntryId: entry.id },
      include: returnInclude,
    });

    const billingReferenceId = await resolveBillingReferenceNumber(tenantId, salesReturn.relatedInvoiceId);
    const chain = billingReferenceId
      ? await reserveZatcaChain(tx, {
          company, customer: salesReturn.customer, kind: "credit_note", documentNumber: salesReturn.returnNumber, documentUuid: salesReturn.zatcaUuid, billingReferenceId, lines: salesReturn.lines,
        })
      : null;
    if (!chain) return updated;

    return tx.salesReturn.update({
      where: { id },
      data: {
        icv: chain.icv, previousInvoiceHash: chain.previousInvoiceHash, invoiceHash: chain.invoiceHash,
        zatcaStatus: chain.zatcaStatus, zatcaSubmittedAt: chain.issuedAt,
      },
      include: returnInclude,
    });
  });
}

export async function unpostSalesReturn(tenantId: string, userId: string, id: string, pin: string) {
  const salesReturn = await prisma.salesReturn.findFirst({ where: { id, tenantId } });
  if (!salesReturn) throw notFound("المردود غير موجود");
  if (salesReturn.status !== "posted") throw badRequest("المردود ليس مرحّلاً أصلاً");
  if (salesReturn.zatcaStatus !== "not_applicable") {
    throw badRequest("لا يمكن فك ترحيل مردود مرتبط بسلسلة تجزئة زاتكا (ICV/PIH) — هذا يكسر السلسلة بشكل غير قابل للإصلاح");
  }

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, salesReturn.journalEntryId);
    const updated = await tx.salesReturn.update({
      where: { id },
      data: { status: "draft", journalEntryId: null },
      include: returnInclude,
    });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "SalesReturn", entityId: id });
    return updated;
  });
}
