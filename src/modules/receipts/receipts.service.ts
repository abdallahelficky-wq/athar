import { withInvoiceCredits } from "../../lib/invoiceCredits";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
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
  bankAccountId?: string | null;
  allocations: AllocationInput[];
}

const receiptInclude = { allocations: { include: { invoice: true } }, customer: true, bankAccount: true } as const;
const CREDIT_ACCOUNT_NAME = { cash: "النقدية بالصندوق", bank: "البنك الأهلي - حساب تشغيلي" };

/**
 * يحدد الحساب الدائن الفعلي لسند القبض: للكاش دائماً حساب الصندوق الوحيد، وللبنك يُستخدَم
 * الحساب البنكي الذي اختاره المستخدم صراحةً (يجب أن يكون مُصنَّفاً isBankOrCash ضمن مستأجره)
 * — أو، للتوافق مع السندات المُنشأة قبل إتاحة هذا الاختيار، الحساب البنكي الافتراضي القديم.
 */
async function resolveCreditAccountId(tenantId: string, companyId: string, method: "cash" | "bank", bankAccountId?: string | null) {
  if (method === "cash") return getAccountIdByName(tenantId, companyId, CREDIT_ACCOUNT_NAME.cash);
  if (bankAccountId) {
    const account = await prisma.account.findFirst({
      where: { id: bankAccountId, tenantId, companyId, isBankOrCash: true, isPosting: true, isActive: true, isArchived: false },
    });
    if (!account) throw badRequest("الحساب البنكي المحدد غير موجود ضمن شجرة حسابات هذه الشركة أو غير مُصنَّف كحساب بنكي/نقدي");
    return account.id;
  }
  return getAccountIdByName(tenantId, companyId, CREDIT_ACCOUNT_NAME.bank);
}

export async function listReceipts(tenantId: string, filters: { companyId?: string; customerId?: string }) {
  const receipts = await prisma.receipt.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, customerId: filters.customerId || undefined },
    include: receiptInclude,
    orderBy: { createdAt: "desc" },
  });
  return receipts.map((r) => ({ ...r, unappliedAmount: unappliedAmountOf(r) }));
}

/** الفواتير المستحقة على عميل معيّن (غير مسددة بالكامل بعد) — مطابق للفلترة في ReceiptsModule */
export async function getOutstandingInvoices(tenantId: string, customerId: string) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, customerId, status: "posted" },
    include: { receiptAllocations: true },
    orderBy: { date: "asc" },
  });
  return (await withInvoiceCredits(tenantId, invoices))
    .map((inv) => {
      const paid = inv.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
      return { id: inv.id, invoiceNumber: inv.invoiceNumber, date: inv.date, grandTotal: Number(inv.grandTotal), paid, due: inv.outstandingAmount };
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

  const creditAccountId = await resolveCreditAccountId(tenantId, input.companyId, input.method, input.bankAccountId);
  const receivableId = await resolvePartyAccountId(tenantId, input.companyId, customer, "ذمم مدينة");

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
        bankAccountId: input.method === "bank" ? creditAccountId : null,
        totalAmount: totalAllocated,
        status: "posted",
        journalEntryId: entry.id,
        allocations: { create: input.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount, createdByUserId: userId })) },
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

  const creditAccountId = await resolveCreditAccountId(tenantId, receipt.companyId, receipt.method, receipt.bankAccountId);
  const receivableId = await resolvePartyAccountId(tenantId, receipt.companyId, receipt.customer, "ذمم مدينة");
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

  await assertValidUnlockPin(tenantId, pin, userId);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, receipt.journalEntryId);
    const updated = await tx.receipt.update({ where: { id }, data: { status: "draft", journalEntryId: null }, include: receiptInclude });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "Receipt", entityId: id });
    return updated;
  });
}

async function dueAmountOf(tenantId: string, invoiceId: string, client: Pick<typeof prisma, "salesInvoice"> = prisma) {
  const invoice = await client.salesInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { receiptAllocations: true },
  });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن ربط سند قبض بفاتورة غير مرحّلة");
  const summary = (await withInvoiceCredits(tenantId, [invoice]))[0];
  return { invoice, due: summary.outstandingAmount };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** الجزء غير المخصَّص من سند قبض: مبلغه الثابت منذ الترحيل ناقص مجموع تخصيصاته الحالية. */
export function unappliedAmountOf(receipt: { totalAmount: unknown; allocations: { amount: unknown }[] }) {
  const allocated = receipt.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
  return Math.round((Number(receipt.totalAmount) - allocated) * 100) / 100;
}

const allocationSnapshot = (allocations: { invoiceId: string; amount: unknown }[]) =>
  allocations.map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) }));

async function writeAllocationAuditTx(
  tx: Tx,
  params: {
    tenantId: string; companyId: string; userId: string; receiptId: string; receiptNumber: string;
    action: "receipt.allocation_added" | "receipt.allocation_removed";
    invoiceId: string; invoiceNumber: string | null; amount: number;
    before: { invoiceId: string; amount: number }[]; after: { invoiceId: string; amount: number }[];
    unappliedBefore: number; unappliedAfter: number;
  },
) {
  const { tenantId, companyId, userId, receiptId, action, ...metadata } = params;
  await tx.auditLog.create({
    data: { tenantId, companyId, userId, action, entityType: "Receipt", entityId: receiptId, metadata },
  });
}

/**
 * تخصيص جزء من سند قبض لفاتورة — عملية دفتر عملاء فقط: لا يتغيّر مبلغ السند ولا قيده المرحَّل إطلاقاً.
 * المتاح للتخصيص هو الجزء غير المخصَّص من السند (مبلغه ناقص تخصيصاته)، ولا يتجاوز المتبقي على
 * الفاتورة. استلام نقد إضافي يعني سند قبض جديداً، لا تكبير سند قائم. السند والفاتورة يُقفلان داخل
 * المعاملة (FOR UPDATE) حتى لا يتجاوز تخصيصان متزامنان الرصيد المتاح.
 */
export async function addReceiptAllocation(tenantId: string, userId: string, id: string, invoiceId: string, amount: number) {
  if (!(amount > 0)) throw badRequest("المبلغ يجب أن يكون أكبر من صفر");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "receipts" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "sales_invoices" WHERE id = ${invoiceId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const receipt = await tx.receipt.findFirst({ where: { id, tenantId }, include: { allocations: true } });
    if (!receipt) throw notFound("سند القبض غير موجود");
    if (receipt.allocations.some((a) => a.invoiceId === invoiceId)) throw badRequest("هذه الفاتورة مرتبطة بالفعل بهذا السند");

    const { invoice, due } = await dueAmountOf(tenantId, invoiceId, tx);
    if (invoice.customerId !== receipt.customerId) throw badRequest("لا يمكن ربط فاتورة عميل مختلف عن عميل السند");
    const unapplied = unappliedAmountOf(receipt);
    if (amount > unapplied + 0.005) {
      throw badRequest(`المبلغ أكبر من غير المخصَّص من السند (${unapplied.toFixed(2)}) — النقد الإضافي يُسجَّل بسند قبض جديد`);
    }
    if (amount > due + 0.01) throw badRequest(`المبلغ أكبر من المتبقي على هذه الفاتورة (${due.toFixed(2)})`);

    const before = allocationSnapshot(receipt.allocations);
    await tx.receiptAllocation.create({ data: { receiptId: id, invoiceId, amount, createdByUserId: userId } });
    await writeAllocationAuditTx(tx, {
      tenantId, companyId: receipt.companyId, userId, receiptId: id, receiptNumber: receipt.receiptNumber,
      action: "receipt.allocation_added", invoiceId, invoiceNumber: invoice.invoiceNumber, amount,
      before, after: [...before, { invoiceId, amount }],
      unappliedBefore: unapplied, unappliedAfter: Math.round((unapplied - amount) * 100) / 100,
    });
    return tx.receipt.findUniqueOrThrow({ where: { id }, include: receiptInclude });
  });
}

/**
 * فك تخصيص فاتورة عن سند قبض — يعود مبلغه إلى الجزء غير المخصَّص من السند، ولا يتغيّر مبلغ السند
 * ولا قيده المرحَّل. مسموح حتى لآخر تخصيص (يبقى السند كاملاً غير مخصَّص).
 */
export async function removeReceiptAllocation(tenantId: string, userId: string, id: string, invoiceId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "receipts" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const receipt = await tx.receipt.findFirst({ where: { id, tenantId }, include: { allocations: { include: { invoice: { select: { invoiceNumber: true } } } } } });
    if (!receipt) throw notFound("سند القبض غير موجود");
    const allocation = receipt.allocations.find((a) => a.invoiceId === invoiceId);
    if (!allocation) throw notFound("هذه الفاتورة غير مرتبطة بهذا السند");

    const before = allocationSnapshot(receipt.allocations);
    const unapplied = unappliedAmountOf(receipt);
    await tx.receiptAllocation.delete({ where: { id: allocation.id } });
    await writeAllocationAuditTx(tx, {
      tenantId, companyId: receipt.companyId, userId, receiptId: id, receiptNumber: receipt.receiptNumber,
      action: "receipt.allocation_removed", invoiceId, invoiceNumber: allocation.invoice.invoiceNumber, amount: Number(allocation.amount),
      before, after: before.filter((a) => a.invoiceId !== invoiceId),
      unappliedBefore: unapplied, unappliedAfter: Math.round((unapplied + Number(allocation.amount)) * 100) / 100,
    });
    return tx.receipt.findUniqueOrThrow({ where: { id }, include: receiptInclude });
  });
}
