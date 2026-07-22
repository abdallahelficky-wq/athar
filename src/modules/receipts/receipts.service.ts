import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { formatDocNumber } from "../../lib/docNumber";

interface AllocationInput {
  invoiceId: string;
  amount: number;
}

interface ReceiptInput {
  companyId: string;
  customerId: string;
  date: Date;
  method: "cash" | "bank";
  allocations: AllocationInput[];
}

const receiptInclude = { allocations: { include: { invoice: true } }, customer: true } as const;
const CREDIT_ACCOUNT_NAME = { cash: "النقدية بالصندوق", bank: "البنك الأهلي - حساب تشغيلي" };

export async function listReceipts(tenantId: string, filters: { companyId?: string; customerId?: string }) {
  return prisma.receipt.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, customerId: filters.customerId || undefined },
    include: receiptInclude,
    orderBy: { createdAt: "desc" },
  });
}

/** الفواتير المستحقة على عميل معيّن (غير مسددة بالكامل بعد) — مطابق للفلترة في ReceiptsModule */
export async function getOutstandingInvoices(tenantId: string, customerId: string) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, customerId, status: "posted" },
    include: { receiptAllocations: true },
    orderBy: { date: "asc" },
  });
  return invoices
    .map((inv) => {
      const paid = inv.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
      return { id: inv.id, invoiceNumber: inv.invoiceNumber, date: inv.date, grandTotal: Number(inv.grandTotal), paid, due: Number(inv.grandTotal) - paid };
    })
    .filter((inv) => inv.due > 0.5);
}

export async function createReceipt(tenantId: string, userId: string, input: ReceiptInput) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: input.companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");

  const outstanding = await getOutstandingInvoices(tenantId, input.customerId);
  const byInvoiceId = new Map(outstanding.map((i) => [i.id, i]));

  for (const alloc of input.allocations) {
    const inv = byInvoiceId.get(alloc.invoiceId);
    if (!inv) throw badRequest("إحدى الفواتير المخصصة غير مستحقة على هذا العميل");
    if (alloc.amount > inv.due + 0.01) {
      throw badRequest(`المبلغ المخصص للفاتورة ${inv.invoiceNumber} أكبر من المتبقي عليها (${inv.due.toFixed(2)})`);
    }
  }

  const totalAllocated = input.allocations.reduce((s, a) => s + a.amount, 0);
  if (totalAllocated <= 0) throw badRequest("إجمالي المبلغ المخصص يجب أن يكون أكبر من صفر");

  const creditAccountId = await getAccountIdByName(tenantId, CREDIT_ACCOUNT_NAME[input.method]);
  const receivableId = await getAccountIdByName(tenantId, "ذمم مدينة");

  const journalLines = [
    { accountId: creditAccountId, department: "المالية والحسابات", debit: totalAllocated, credit: 0, customerId: input.customerId },
    { accountId: receivableId, department: "المالية والحسابات", debit: 0, credit: totalAllocated, customerId: input.customerId },
  ];

  const count = await prisma.receipt.count({ where: { tenantId } });
  const receiptNumber = formatDocNumber("REC", count);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: `سند قبض ${receiptNumber} — ${customer.name}`,
      sourceModule: "receipt",
      createdBy: userId,
      lines: journalLines,
    });

    const receipt = await tx.receipt.create({
      data: {
        tenantId,
        receiptNumber,
        companyId: input.companyId,
        customerId: input.customerId,
        date: input.date,
        method: input.method,
        totalAmount: totalAllocated,
        status: "posted",
        journalEntryId: entry.id,
        allocations: { create: input.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) },
      },
      include: receiptInclude,
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: receipt.id } });
    return receipt;
  });
}

export async function deleteReceipt(tenantId: string, id: string) {
  const existing = await prisma.receipt.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("سند القبض غير موجود");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف سند مرحّل، يجب فك ترحيله أولاً");
  await prisma.receipt.delete({ where: { id } });
}

export async function postReceipt(tenantId: string, userId: string, id: string) {
  const receipt = await prisma.receipt.findFirst({ where: { id, tenantId }, include: { customer: true } });
  if (!receipt) throw notFound("سند القبض غير موجود");
  if (receipt.status === "posted") throw badRequest("السند مرحّل بالفعل");

  const creditAccountId = await getAccountIdByName(tenantId, CREDIT_ACCOUNT_NAME[receipt.method]);
  const receivableId = await getAccountIdByName(tenantId, "ذمم مدينة");
  const total = Number(receipt.totalAmount);

  const journalLines = [
    { accountId: creditAccountId, department: "المالية والحسابات", debit: total, credit: 0, customerId: receipt.customerId },
    { accountId: receivableId, department: "المالية والحسابات", debit: 0, credit: total, customerId: receipt.customerId },
  ];

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: receipt.companyId,
      date: receipt.date,
      memo: `سند قبض ${receipt.receiptNumber} — ${receipt.customer.name}`,
      sourceModule: "receipt",
      sourceId: receipt.id,
      createdBy: userId,
      lines: journalLines,
    });
    return tx.receipt.update({ where: { id }, data: { status: "posted", journalEntryId: entry.id }, include: receiptInclude });
  });
}

export async function unpostReceipt(tenantId: string, userId: string, id: string, pin: string) {
  const receipt = await prisma.receipt.findFirst({ where: { id, tenantId } });
  if (!receipt) throw notFound("سند القبض غير موجود");
  if (receipt.status !== "posted") throw badRequest("السند ليس مرحّلاً أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, receipt.journalEntryId);
    const updated = await tx.receipt.update({ where: { id }, data: { status: "draft", journalEntryId: null }, include: receiptInclude });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "Receipt", entityId: id });
    return updated;
  });
}
