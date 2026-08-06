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

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, receipt.journalEntryId);
    const updated = await tx.receipt.update({ where: { id }, data: { status: "draft", journalEntryId: null }, include: receiptInclude });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "Receipt", entityId: id });
    return updated;
  });
}

/**
 * يُعيد إنشاء قيد السند بإجمالي جديد (بعد إضافة/إزالة تخصيص) — يحذف القيد القديم وينشئ
 * قيداً جديداً بدلاً منه بنفس منطق الإنشاء الأصلي، حتى يبقى القيد مطابقاً دائماً لمجموع
 * التخصيصات الفعلي على السند. لا يُنفَّذ شيء إن كان السند أصلاً غير مرحّل (draft).
 */
async function repostReceiptEntryTx(
  tx: Parameters<typeof createJournalEntryTx>[0],
  receipt: {
    id: string; tenantId: string; companyId: string; customerId: string; date: Date; receiptNumber: string;
    method: "cash" | "bank"; bankAccountId: string | null; status: string; journalEntryId: string | null;
    customer: { accountId: string | null };
  },
  customerName: string,
  newTotal: number,
) {
  if (receipt.status !== "posted") return null;
  await deleteJournalEntryTx(tx, receipt.journalEntryId);
  const creditAccountId = await resolveCreditAccountId(receipt.tenantId, receipt.companyId, receipt.method, receipt.bankAccountId);
  const receivableId = await resolvePartyAccountId(receipt.tenantId, receipt.companyId, receipt.customer, "ذمم مدينة");
  const entry = await createJournalEntryTx(tx, {
    tenantId: receipt.tenantId,
    companyId: receipt.companyId,
    date: receipt.date,
    memo: `سند قبض ${receipt.receiptNumber} — ${customerName}`,
    sourceModule: "receipt",
    sourceId: receipt.id,
    lines: [
      { accountId: creditAccountId, department: "المالية والحسابات", debit: newTotal, credit: 0, customerId: receipt.customerId },
      { accountId: receivableId, department: "المالية والحسابات", debit: 0, credit: newTotal, customerId: receipt.customerId },
    ],
  });
  return entry.id;
}

async function dueAmountOf(tenantId: string, invoiceId: string) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { receiptAllocations: true },
  });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن ربط سند قبض بفاتورة غير مرحّلة");
  const paid = invoice.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
  return { invoice, due: Number(invoice.grandTotal) - paid };
}

/** ربط فاتورة إضافية بسند قبض موجود بالفعل — يزيد إجمالي السند وقيده المحاسبي المرتبط */
export async function addReceiptAllocation(tenantId: string, id: string, invoiceId: string, amount: number) {
  const receipt = await prisma.receipt.findFirst({ where: { id, tenantId }, include: receiptInclude });
  if (!receipt) throw notFound("سند القبض غير موجود");
  if (amount <= 0) throw badRequest("المبلغ يجب أن يكون أكبر من صفر");

  if (receipt.allocations.some((a) => a.invoiceId === invoiceId)) {
    throw badRequest("هذه الفاتورة مرتبطة بالفعل بهذا السند");
  }

  const { invoice, due } = await dueAmountOf(tenantId, invoiceId);
  if (invoice.customerId !== receipt.customerId) {
    throw badRequest("لا يمكن ربط فاتورة عميل مختلف عن عميل السند");
  }
  if (amount > due + 0.01) {
    throw badRequest(`المبلغ أكبر من المتبقي على هذه الفاتورة (${due.toFixed(2)})`);
  }

  const newTotal = Number(receipt.totalAmount) + amount;

  return prisma.$transaction(async (tx) => {
    const newEntryId = await repostReceiptEntryTx(tx, receipt, receipt.customer.name, newTotal);
    return tx.receipt.update({
      where: { id },
      data: {
        totalAmount: newTotal,
        ...(newEntryId ? { journalEntryId: newEntryId } : {}),
        allocations: { create: { invoiceId, amount } },
      },
      include: receiptInclude,
    });
  });
}

/** فك ربط فاتورة عن سند قبض — يُنقص إجمالي السند وقيده المحاسبي، ويُرفَض إن كان آخر تخصيص */
export async function removeReceiptAllocation(tenantId: string, id: string, invoiceId: string) {
  const receipt = await prisma.receipt.findFirst({ where: { id, tenantId }, include: receiptInclude });
  if (!receipt) throw notFound("سند القبض غير موجود");

  const allocation = receipt.allocations.find((a) => a.invoiceId === invoiceId);
  if (!allocation) throw notFound("هذه الفاتورة غير مرتبطة بهذا السند");

  if (receipt.allocations.length === 1) {
    throw badRequest("هذا آخر تخصيص في هذا السند — احذف السند نفسه (بعد فك ترحيله إن كان مرحّلاً) بدل فك ربط آخر فاتورة فيه");
  }

  const newTotal = Number(receipt.totalAmount) - Number(allocation.amount);

  return prisma.$transaction(async (tx) => {
    const newEntryId = await repostReceiptEntryTx(tx, receipt, receipt.customer.name, newTotal);
    await tx.receiptAllocation.delete({ where: { id: allocation.id } });
    return tx.receipt.update({
      where: { id },
      data: { totalAmount: newTotal, ...(newEntryId ? { journalEntryId: newEntryId } : {}) },
      include: receiptInclude,
    });
  });
}
