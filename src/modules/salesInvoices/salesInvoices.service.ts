import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine, invoiceTypeForCustomer } from "../../lib/invoiceLine";
import { buildZatcaQrPayload } from "../../lib/zatcaQr";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { getStockBalance } from "../stockMovements/stockMovements.service";
import { isValueTrackedInLedger, isQuantityTracked } from "../items/items.service";
import { evaluateZatcaPostingGate } from "../../lib/zatca/postingGate";
import { resubmitZatcaDocument } from "../../lib/zatca/resubmit";
import { sendInvoiceByEmail } from "./salesInvoiceEmail.service";
import { accrueTrainerCommissionsTx, reverseTrainerCommissionsTx } from "../stables/stablesBilling.service";

type Tx = Prisma.TransactionClient;

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

interface InvoiceInput {
  companyId: string;
  customerId: string;
  branchId?: string | null;
  date: Date;
  // حقول اختيارية بحتة (شريط معلومات الفاتورة لبعض القوالب) — لا تأثير محاسبي/ضريبي لها إطلاقاً
  dueDate?: Date | null;
  customerReference?: string;
  poNumber?: string;
  salesperson?: string;
  otherId?: string;
  lines: LineInput[];
  post?: boolean;
  // مستودع محدَّد صراحةً (مثلاً من إعدادات جهاز نقطة بيع) يتجاوز مستودع الشركة الافتراضي —
  // اختياري: الفواتير العادية (شاشة فواتير المبيعات) تستمر باستخدام المستودع الافتراضي كما هي.
  warehouseId?: string;
}

/** يحل المستودع الفعلي المطلوب خصم المخزون منه: المستودع المُمرَّر صراحةً (بعد التحقق أنه ينتمي
 * لنفس الشركة/المستأجر) وإلا المستودع الافتراضي للشركة — بنفس رسالة الخطأ القديمة حرفياً في حالة
 * عدم التمرير، حتى لا يتغيّر سلوك أي مسار حالي لا يمرّر warehouseId. */
async function resolveWarehouse(tx: Tx | typeof prisma, tenantId: string, companyId: string, warehouseId?: string) {
  if (warehouseId) {
    const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, tenantId, companyId } });
    if (!warehouse) throw badRequest("المستودع المحدد غير موجود ضمن هذه الشركة");
    return warehouse;
  }
  const warehouse = await tx.warehouse.findFirst({ where: { tenantId, companyId, isDefault: true } });
  if (!warehouse) throw badRequest("لا يوجد مستودع افتراضي محدد لهذه الشركة؛ حدّده من شاشة المستودعات أولاً");
  return warehouse;
}

const invoiceInclude = {
  lines: { include: { account: true, item: true } },
  customer: true,
  company: true,
  branch: true,
  receiptAllocations: true,
  // آخر محاولة إرسال بالإيميل فقط (نجحت أو فشلت) — تُستخدَم لعرض "آخر إرسال: ..." في شاشة الفاتورة.
  emailLogs: { orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;

function computeLines(lines: LineInput[]) {
  const computed = lines.map((l) => ({
    ...l,
    ...computeInvoiceLine(l),
    // فئة الضريبة القياسية لزاتكا (S/O) تُشتق من vatApplicable الحالي — لا حقل إدخال جديد بعد.
    taxCategoryCode: l.vatApplicable === false ? ("O" as const) : ("S" as const),
    taxExemptionReason: null as string | null,
  }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  return { computed, subtotal, vatTotal, grandTotal };
}

/**
 * الحساب المحاسبي المرتبط بكل صنف يُحدَّد من شاشة الصنف نفسها (revenueAccountId) لا من
 * الفاتورة — أي accountId يرسله العميل لسطر مرتبط بصنف يُتجاهَل ويُستبدَل. الأسطر بلا itemId
 * (وصف حر) تحتفظ بالـ accountId اليدوي كما هو.
 */
async function resolveLineAccounts(tenantId: string, companyId: string, lines: LineInput[]): Promise<LineInput[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } }) : [];
  if (items.length !== itemIds.length) throw badRequest("أحد الأصناف المختارة غير موجود ضمن هذه الشركة");
  const itemById = new Map(items.map((i) => [i.id, i]));

  return lines.map((line) => {
    if (!line.itemId) return line;
    const item = itemById.get(line.itemId)!;
    if (item.type === "expense") throw badRequest(`الصنف "${item.name}" من نوع مصروف، لا يمكن بيعه`);
    if (item.type === "fixed_asset") throw badRequest(`الصنف "${item.name}" أصل ثابت، لا يُباع عبر فاتورة مبيعات`);
    if (item.type === "raw_material" && !item.allowDirectSale) throw badRequest(`الصنف "${item.name}" مادة أولية غير مسموح ببيعها منفردة`);
    if (!item.revenueAccountId) throw badRequest(`لم يُحدَّد حساب الإيراد المرتبط بالصنف "${item.name}" بعد؛ أكمل بياناته من شاشة الأصناف أولاً`);
    return { ...line, accountId: item.revenueAccountId };
  });
}

async function assertRefs(tenantId: string, companyId: string, customerId: string, lines: LineInput[], branchId?: string | null) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId, companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId, companyId } });
    if (!branch) throw badRequest("الفرع المحدد غير موجود ضمن هذه الشركة");
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");
  return { company, customer };
}

/** يبني سطور قيد تكلفة البضاعة المباعة (لو فيه أصناف مخزونية بالفاتورة)، ويتحقق من كفاية الرصيد قبل الترحيل — لا يكتب أي شيء لقاعدة البيانات، للاستدعاء قبل بناء القيد. */
async function computeCogsJournalLines(tenantId: string, companyId: string, lines: LineInput[], warehouseId?: string) {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  if (!itemIds.length) return [];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  // periodic_inventory مستثنى عمداً هنا (isValueTrackedInLedger لا isQuantityTracked): بلا قيد تكلفة
  // وبلا فحص كفاية رصيد إطلاقاً لهذا النوع — راجع دليله في items.schemas.ts.
  const stockLines = lines.filter((l) => l.itemId && isValueTrackedInLedger(itemById.get(l.itemId)!.type));
  if (!stockLines.length) return [];

  const warehouse = await resolveWarehouse(prisma, tenantId, companyId, warehouseId);

  // يجب تجميع الكمية الإجمالية المطلوبة لكل صنف عبر كل أسطر الفاتورة قبل مقارنتها بالرصيد —
  // وإلا فسطران لنفس الصنف يمكن أن يتجاوزا الرصيد المتاح مجتمعين رغم أن كل سطر بمفرده يبدو
  // صالحاً عند مقارنته منفرداً بنفس الرصيد (الذي لم يتغيّر بعد لأن الفاتورة لم تُحفَظ بعد).
  const totalQtyByItem = new Map<string, number>();
  for (const line of stockLines) {
    totalQtyByItem.set(line.itemId!, (totalQtyByItem.get(line.itemId!) || 0) + line.quantity);
  }
  for (const [itemId, totalQty] of totalQtyByItem) {
    const item = itemById.get(itemId)!;
    const balance = await getStockBalance(tenantId, itemId, warehouse.id);
    if (totalQty > balance) throw badRequest(`الكمية الإجمالية المطلوبة من "${item.name}" (${totalQty}) أكبر من الرصيد المتاح (${balance})`);
  }

  const byAccount = new Map<string, { debit: number; credit: number }>();
  const add = (accountId: string, debit: number, credit: number) => {
    const cur = byAccount.get(accountId) || { debit: 0, credit: 0 };
    byAccount.set(accountId, { debit: cur.debit + debit, credit: cur.credit + credit });
  };

  for (const line of stockLines) {
    const item = itemById.get(line.itemId!)!;
    if (!item.cogsAccountId || !item.stockAccountId) {
      throw badRequest(`لم تُحدَّد حسابات المخزون/التكلفة للصنف "${item.name}" بعد؛ أكمل بياناته من شاشة الأصناف أولاً`);
    }
    const amount = line.quantity * Number(item.averageCost);
    add(item.cogsAccountId, amount, 0);
    add(item.stockAccountId, 0, amount);
  }

  return [...byAccount.entries()].map(([accountId, { debit, credit }]) => ({ accountId, department: "المبيعات والتسويق", debit, credit }));
}

/** يُنشئ حركة "صرف" مخزنية لكل سطر فاتورة مرتبط بصنف مخزوني — يُستدعى بعد حفظ الفاتورة فعلياً (يحتاج line.id). */
async function createStockOutSideEffectsTx(
  tx: Tx,
  tenantId: string,
  companyId: string,
  date: Date,
  persistedLines: Array<{ id: string; itemId: string | null; quantity: Prisma.Decimal }>,
  journalEntryId: string,
  warehouseId?: string,
) {
  const itemIds = persistedLines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  if (!itemIds.length) return;
  const warehouse = await resolveWarehouse(tx, tenantId, companyId, warehouseId);

  for (const line of persistedLines) {
    if (!line.itemId) continue;
    const item = await tx.item.findFirstOrThrow({ where: { id: line.itemId, tenantId } });
    // periodic_inventory يصل هنا فعلاً (isQuantityTracked لا isValueTrackedInLedger) — حركة "صادر"
    // تشغيلية بحتة لتتبّع الكمية فقط، unitCost يبقى 0 دائماً لأن averageCost لا يُحدَّث لهذا النوع.
    if (!isQuantityTracked(item.type)) continue;
    await tx.stockMovement.create({
      data: {
        tenantId, companyId, itemId: item.id, warehouseId: warehouse.id, type: "out",
        quantity: line.quantity, unitCost: item.averageCost, date, journalEntryId, sourceSalesInvoiceLineId: line.id,
      },
    });
  }
}

async function removeStockOutSideEffectsTx(tx: Tx, invoiceId: string) {
  const lineIds = (await tx.salesInvoiceLine.findMany({ where: { invoiceId }, select: { id: true } })).map((l) => l.id);
  if (!lineIds.length) return;
  await tx.stockMovement.deleteMany({ where: { sourceSalesInvoiceLineId: { in: lineIds } } });
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

// حالات زاتكا التي تعني أن الفاتورة لم تُبلَّغ/تُخلَّص بنجاح بعد — إما لا تزال قيد المحاولة الأولى
// (pending_*) أو فشلت (رُفضت صراحةً أو تعذّر الوصول لزاتكا أصلاً). تُستخدَم فقط لعرض قائمة متابعة
// للمستخدم — لا تُغيّر أي سلوك ترحيل.
const ZATCA_BACKLOG_STATUSES = ["pending_clearance", "pending_reporting", "rejected", "submission_failed"] as const;

/**
 * قائمة الفواتير التي لم تُبلَّغ/تُخلَّص بنجاح لدى زاتكا بعد — لمتابعة أي فاتورة قد لا تصل إليها
 * إطلاقاً (خصوصاً بعد معالجة تعذّر الاتصال بالشبكة بترحيلها بدل إسقاطها، راجع submission_failed).
 */
export async function listZatcaBacklog(tenantId: string, filters: { companyId?: string }) {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      companyId: filters.companyId || undefined,
      status: "posted",
      zatcaStatus: { in: [...ZATCA_BACKLOG_STATUSES] },
    },
    select: { id: true, invoiceNumber: true, date: true, grandTotal: true, zatcaStatus: true, zatcaSubmittedAt: true },
    orderBy: { date: "asc" },
  });
  const now = Date.now();
  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    date: inv.date,
    grandTotal: inv.grandTotal,
    zatcaStatus: inv.zatcaStatus,
    ageDays: Math.floor((now - (inv.zatcaSubmittedAt ?? inv.date).getTime()) / (1000 * 60 * 60 * 24)),
  }));
}

export async function getSalesInvoice(tenantId: string, id: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  return withPaymentStatus(invoice);
}

async function buildJournalLines(
  tenantId: string,
  companyId: string,
  customer: { id: string; accountId: string | null },
  computed: Array<LineInput & { subtotal: number; vat: number; total: number }>,
  vatTotal: number,
  grandTotal: number,
  cogsLines: Array<{ accountId: string; department: string; debit: number; credit: number }> = [],
) {
  const customerId = customer.id;
  const vatOutputId = await getAccountIdByName(tenantId, companyId, "ضريبة القيمة المضافة - مخرجات");
  const receivableId = await resolvePartyAccountId(tenantId, companyId, customer, "ذمم مدينة");
  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  return [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: 0, credit: amount, customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: 0, credit: vatTotal, customerId },
    { accountId: receivableId, department: "المالية والحسابات", debit: grandTotal, credit: 0, customerId },
    ...cogsLines,
  ];
}

export async function createSalesInvoice(tenantId: string, userId: string, input: InvoiceInput) {
  input = { ...input, lines: await resolveLineAccounts(tenantId, input.companyId, input.lines) };
  const { customer, company } = await assertRefs(tenantId, input.companyId, input.customerId, input.lines, input.branchId);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");

  const invType = invoiceTypeForCustomer(customer);
  const qrPayload = buildZatcaQrPayload(
    company.name,
    company.vatNumber || "",
    `${input.date.toISOString().slice(0, 10)}T12:00:00`,
    grandTotal,
    vatTotal,
  );

  const shouldPost = input.post !== false;

  if (!shouldPost) {
    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await reserveDocumentNumber(tx, tenantId, input.companyId, "sales_invoice");
      return tx.salesInvoice.create({
        data: {
          tenantId,
          invoiceNumber,
          companyId: input.companyId,
          customerId: input.customerId,
          branchId: input.branchId || undefined,
          date: input.date,
          dueDate: input.dueDate || undefined,
          customerReference: input.customerReference,
          poNumber: input.poNumber,
          salesperson: input.salesperson,
          otherId: input.otherId,
          invoiceType: invType,
          status: "draft",
          qrPayload,
          subtotal,
          vatTotal,
          grandTotal,
          lines: { create: computed },
        },
        include: invoiceInclude,
      });
    });
    return withPaymentStatus(invoice);
  }

  const cogsLines = await computeCogsJournalLines(tenantId, input.companyId, input.lines, input.warehouseId);
  const journalLines = await buildJournalLines(tenantId, input.companyId, customer, computed, vatTotal, grandTotal, cogsLines);
  const zatcaUuid = randomUUID();

  const created = await prisma.$transaction(async (tx) => {
    // رقم الفاتورة يُحجَز هنا داخل نفس المعاملة (وليس قبلها) — لو رفضته بوابة زاتكا أدناه فتُلغى
    // المعاملة بالكامل، فلا يُستهلَك أي رقم لفاتورة لم تُنشَأ فعلياً (بلا فجوات في التسلسل).
    const invoiceNumber = await reserveDocumentNumber(tx, tenantId, input.companyId, "sales_invoice");

    // بوابة زاتكا أولاً، قبل أي كتابة فعلية: فاتورة قياسية (B2B) ترفضها زاتكا يجب ألا تُنشَأ ولا
    // تُرحَّل إطلاقاً (لا تُعتبر فاتورة نهائية حتى تُقبَل فعلياً) — رمي الاستثناء هنا يُلغي المعاملة
    // بأكملها بلا أي أثر جانبي متبقٍّ في قاعدة البيانات.
    const gate = await evaluateZatcaPostingGate({
      tx, company, customer, kind: "invoice", documentNumber: invoiceNumber, documentUuid: zatcaUuid,
      lines: computed.map((l) => ({ ...l, description: l.description ?? null })), grandTotal, vatTotal,
    });
    if (!gate.proceedWithPosting) {
      throw badRequest(`رفضت هيئة الزكاة والضريبة والجمارك الفاتورة: ${gate.rejectionReason}`);
    }

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      branchId: input.branchId || undefined,
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
        branchId: input.branchId || undefined,
        date: input.date,
        dueDate: input.dueDate || undefined,
        customerReference: input.customerReference,
        poNumber: input.poNumber,
        salesperson: input.salesperson,
        otherId: input.otherId,
        invoiceType: invType,
        status: "posted",
        journalEntryId: entry.id,
        qrPayload,
        zatcaUuid,
        ...gate.zatcaFields,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      },
      include: invoiceInclude,
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: invoice.id } });
    await createStockOutSideEffectsTx(tx, tenantId, input.companyId, input.date, invoice.lines, entry.id, input.warehouseId);

    return withPaymentStatus(invoice);
  });

  // نفس منطق الإرسال التلقائي في postSalesInvoice — مسار "حفظ وترحيل" هنا مستقل تماماً (إنشاء
  // وترحيل في نفس المعاملة) وليس استدعاءً لـ postSalesInvoice، فيحتاج نفس الخُطّاف صراحةً.
  const emailResult = await sendInvoiceByEmail(tenantId, created.id, { method: "auto" });
  return { ...created, emailResult };
}

export async function updateSalesInvoice(tenantId: string, id: string, input: InvoiceInput) {
  const existing = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن تعديل فاتورة مرحّلة، يجب فك ترحيلها أولاً");

  input = { ...input, lines: await resolveLineAccounts(tenantId, input.companyId, input.lines) };
  const { customer } = await assertRefs(tenantId, input.companyId, input.customerId, input.lines, input.branchId);
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
        branchId: input.branchId ?? null,
        date: input.date,
        dueDate: input.dueDate ?? null,
        customerReference: input.customerReference,
        poNumber: input.poNumber,
        salesperson: input.salesperson,
        otherId: input.otherId,
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
  const company = await prisma.company.findFirstOrThrow({ where: { id: invoice.companyId, tenantId } });

  const computed = invoice.lines.map((l) => ({
    accountId: l.accountId, itemId: l.itemId ?? undefined, subtotal: Number(l.subtotal), vat: Number(l.vat), total: Number(l.total),
    quantity: Number(l.quantity), unitPrice: Number(l.unitPrice),
  }));
  const cogsLines = await computeCogsJournalLines(tenantId, invoice.companyId, computed);
  const journalLines = await buildJournalLines(tenantId, invoice.companyId, invoice.customer, computed, Number(invoice.vatTotal), Number(invoice.grandTotal), cogsLines);

  const posted = await prisma.$transaction(async (tx) => {
    const gate = await evaluateZatcaPostingGate({
      tx, company, customer: invoice.customer, kind: "invoice", documentNumber: invoice.invoiceNumber, documentUuid: invoice.zatcaUuid,
      lines: invoice.lines, grandTotal: Number(invoice.grandTotal), vatTotal: Number(invoice.vatTotal),
    });
    if (!gate.proceedWithPosting) {
      throw badRequest(`رفضت هيئة الزكاة والضريبة والجمارك الفاتورة: ${gate.rejectionReason}`);
    }

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: invoice.companyId,
      branchId: invoice.branchId,
      date: invoice.date,
      memo: `فاتورة مبيعات ${invoice.invoiceNumber} — ${invoice.customer.name}`,
      sourceModule: "sales_invoice",
      sourceId: invoice.id,
      createdBy: userId,
      lines: journalLines,
    });
    const updated = await tx.salesInvoice.update({
      where: { id },
      data: { status: "posted", journalEntryId: entry.id, ...gate.zatcaFields },
      include: invoiceInclude,
    });
    await createStockOutSideEffectsTx(tx, tenantId, invoice.companyId, invoice.date, invoice.lines, entry.id);
    await accrueTrainerCommissionsTx(tx, tenantId, invoice.companyId, invoice.id, userId);

    return withPaymentStatus(updated);
  });

  // إرسال الفاتورة بالإيميل يحدث فقط بعد نجاح الترحيل فعلياً (لا عند الحفظ كمسودة) — قرار
  // مقصود: فاتورة لسه قابلة للتعديل ليست جاهزة لتصل للعميل بعد. لا يُفشل الترحيل أبداً حتى لو
  // فشل الإرسال أو لم يكن للعميل بريد مسجَّل — النتيجة تُعاد للواجهة لعرض تنبيه مناسب فقط.
  const emailResult = await sendInvoiceByEmail(tenantId, id, { method: "auto" });
  return { ...posted, emailResult };
}

type InvoiceWithZatcaChain = Prisma.SalesInvoiceGetPayload<{ include: typeof invoiceInclude }>;

/**
 * ينفّذ إعادة الإرسال الفعلية (يدوية من resendInvoiceToZatca أو تلقائية من runZatcaAutoRetry) على
 * فاتورة تحمل بيانات سلسلة زاتكا الأصلية بالفعل — بلا حجز رقم ICV جديد وبلا أي تعديل على بيانات
 * الفاتورة نفسها، فقط إعادة توقيع وإرسال نفس المحتوى. يُحدِّث حقول زاتكا فقط (لا القيد المحاسبي
 * ولا حالة الترحيل) بصرف النظر عن النتيجة، ويُصفِّر عدّاد المحاولات عند النجاح أو يزيده عند الفشل
 * (يُستخدَم فقط لحساب فترة الانتظار قبل المحاولة التلقائية التالية، راجع isDueForZatcaAutoRetry).
 */
async function performZatcaResubmission(invoice: InvoiceWithZatcaChain) {
  if (invoice.icv == null || !invoice.previousInvoiceHash || !invoice.invoiceHash || !invoice.zatcaSubmittedAt) {
    throw badRequest("بيانات سلسلة زاتكا الأصلية لهذه الفاتورة غير مكتملة — تعذّرت إعادة الإرسال، راجع الدعم الفني");
  }

  if (invoice.zatcaRetryCount > 0) {
    // تنبيه مميَّز مقصود (لا رسالة عادية) يُسجَّل *قبل* إرسال أي محاولة ثانية أو لاحقة لنفس
    // المستند — إن اشتكت زاتكا يوماً من ازدواج مستند بنفس UUID، هذا أول مكان يجب البحث فيه بدل
    // تخمين وقت الإرسال المزدوج من سجلات متفرقة.
    // eslint-disable-next-line no-console
    console.warn(
      `[zatcaResubmission] REPEATED SUBMISSION — محاولة رقم ${invoice.zatcaRetryCount + 1} لنفس المستند | ` +
        `الفاتورة=${invoice.invoiceNumber} الشركة=${invoice.company.name} (companyId=${invoice.companyId}) ` +
        `documentUuid=${invoice.zatcaUuid}`,
    );
  }

  const result = await resubmitZatcaDocument({
    company: invoice.company,
    customer: invoice.customer,
    documentNumber: invoice.invoiceNumber,
    documentUuid: invoice.zatcaUuid,
    lines: invoice.lines,
    grandTotal: Number(invoice.grandTotal),
    vatTotal: Number(invoice.vatTotal),
    icv: invoice.icv,
    previousInvoiceHash: invoice.previousInvoiceHash,
    invoiceHash: invoice.invoiceHash,
    issuedAt: invoice.zatcaSubmittedAt,
  });

  const succeeded = result.zatcaStatus === "cleared" || result.zatcaStatus === "reported";
  const updated = await prisma.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      zatcaStatus: result.zatcaStatus,
      zatcaResponseRaw: (result.zatcaResponseRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      zatcaClearedOrReportedAt: result.zatcaClearedOrReportedAt,
      zatcaLastAttemptAt: new Date(),
      zatcaRetryCount: succeeded ? 0 : { increment: 1 },
    },
    include: invoiceInclude,
  });
  return { updated, rejectionReason: result.rejectionReason };
}

/**
 * يحجز فاتورة ذرّياً قبل أي محاولة إرسال فعلية (يدوية أو تلقائية) — يُطابِق تحديثه في WHERE قيمتي
 * zatcaRetryCount/zatcaLastAttemptAt المقروءتين بالضبط عند تحميل الفاتورة، فلو نسخة أخرى من
 * الخادم (تدقة تلقائية متزامنة) أو نقرة "إعادة إرسال" أخرى سبقتنا لنفس الفاتورة، هذا التحديث
 * يُطابِق صفراً من الصفوف. يمنع إرسال نفس المستند لزاتكا مرتين بسبب تزامن، سواء بين نسختي خادم أو
 * بين محاولة تلقائية ونقرة يدوية على نفس الفاتورة في نفس اللحظة تقريباً.
 */
async function claimInvoiceForZatcaAttempt(
  invoice: { id: string; zatcaStatus: InvoiceWithZatcaChain["zatcaStatus"]; zatcaRetryCount: number; zatcaLastAttemptAt: Date | null },
  now: Date,
): Promise<boolean> {
  const claim = await prisma.salesInvoice.updateMany({
    where: { id: invoice.id, zatcaStatus: invoice.zatcaStatus, zatcaRetryCount: invoice.zatcaRetryCount, zatcaLastAttemptAt: invoice.zatcaLastAttemptAt },
    data: { zatcaLastAttemptAt: now },
  });
  return claim.count > 0;
}

/**
 * يعيد محاولة إرسال فاتورة مُرحَّلة فعلاً بحالة zatcaStatus = "rejected" (رفضتها زاتكا صراحةً) أو
 * "submission_failed" (تعذّر الوصول إليها أصلاً) لزاتكا. متاحة فقط لهاتين الحالتين تحديداً — أي
 * حالة زاتكا أخرى تُرفَض صراحةً.
 */
export async function resendInvoiceToZatca(tenantId: string, id: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن إعادة الإرسال إلا لفاتورة مُرحَّلة");
  if (invoice.zatcaStatus !== "rejected" && invoice.zatcaStatus !== "submission_failed") {
    throw badRequest("إعادة الإرسال متاحة فقط للفواتير التي رفضتها زاتكا أو تعذّر إرسالها إليها");
  }

  const claimed = await claimInvoiceForZatcaAttempt(invoice, new Date());
  if (!claimed) {
    throw badRequest("جارٍ إعادة إرسال هذه الفاتورة بالفعل الآن (نقرة أخرى أو محاولة تلقائية متزامنة) — انتظر قليلاً ثم تحقّق من حالتها قبل إعادة المحاولة");
  }

  const { updated, rejectionReason } = await performZatcaResubmission(invoice);
  return { ...withPaymentStatus(updated), rejectionReason };
}

// حالات زاتكا المؤهَّلة لإعادة المحاولة التلقائية — لا "rejected" عمداً: رفض فعلي من زاتكا يحتاج
// تصحيح بيانات بشرياً أولاً، وإعادة إرسال نفس المحتوى تلقائياً بلا تغيير سيفشل بنفس السبب دائماً
// (راجع طلب المستخدم: "توقف عن إعادة المحاولة" لحالة الرفض الصريح تحديداً).
const ZATCA_AUTO_RETRY_STATUSES = ["submission_failed", "pending_clearance", "pending_reporting"] as const;

// فترات الانتظار (بالدقائق) بين محاولة تلقائية وأخرى لنفس الفاتورة، مفهرسة بعدد المحاولات
// السابقة (zatcaRetryCount) — تصاعدية لتفادي إغراق زاتكا بمحاولات متكررة على فاتورة يبدو أنها
// تفشل باستمرار (أو شركة لم تُهيّئ شهادتها بعد)، لكنها تبقى ضمن حد أقصى ساعة واحدة — كافٍ لعشرات
// المحاولات خلال مهلة الـ24 ساعة القانونية للإبلاغ عن الفاتورة المبسّطة (Phase 2).
const ZATCA_AUTO_RETRY_BACKOFF_MINUTES = [0, 5, 15, 30, 60] as const;

/** مُصدَّرة للاختبار المباشر بلا حاجة لقاعدة بيانات — منطق حساب الاستحقاق نفسه لا يلمس Prisma. */
export function isDueForZatcaAutoRetry(invoice: { zatcaRetryCount: number; zatcaLastAttemptAt: Date | null }, now: Date): boolean {
  if (!invoice.zatcaLastAttemptAt) return true; // لم تُحاوَل تلقائياً بعد — مؤهَّلة فوراً
  const idx = Math.min(invoice.zatcaRetryCount, ZATCA_AUTO_RETRY_BACKOFF_MINUTES.length - 1);
  const dueAt = invoice.zatcaLastAttemptAt.getTime() + ZATCA_AUTO_RETRY_BACKOFF_MINUTES[idx] * 60_000;
  return now.getTime() >= dueAt;
}

export interface ZatcaAutoRetryRunSummary {
  attempted: number;
  succeeded: number;
  rejected: number;
  stillFailing: number;
}

// سقف أمان لحجم الاستعلام نفسه فقط (لا علاقة له بعدد ما يُرسَل فعلياً لزاتكا في نبضة واحدة، راجع
// ZATCA_AUTO_RETRY_BATCH_SIZE أدناه) — يمنع تحميل جدول ضخم بالكامل في الحالة النادرة لتراكم كبير جداً.
const ZATCA_AUTO_RETRY_QUERY_LIMIT = 500;

// أقصى عدد فواتير تُرسَل فعلياً لزاتكا في نبضة واحدة (كل 5 دقائق، راجع retryScheduler.ts) — يُصرِّف
// تراكم انقطاع ليلي كامل (تقريباً 240 فاتورة لمحطة بمعدل 30 فاتورة/ساعة على مدى 8 ساعات) خلال نحو
// ساعة تقريباً من عودة الاتصال (20 × نبضة كل 5 دقائق = 240 فاتورة/ساعة)، بدل إغراق زاتكا بمئات
// الطلبات دفعة واحدة عند أول نبضة بعد عودة الشبكة.
const ZATCA_AUTO_RETRY_BATCH_SIZE = 20;

/**
 * تُوزَّع فتحات الدفعة الواحدة بالتناوب (round-robin) على كل الشركات التي لديها فواتير مستحقة —
 * فتحة واحدة لكل شركة في كل جولة، لا بحسب أقدم فاتورة على الإطلاق عبر المنصّة كلها — حتى لا
 * تستحوذ شركة واحدة ذات تراكم كبير على الدفعة بأكملها بينما فاتورة شركة أخرى (قد تكون أقرب فعلياً
 * لمهلة الـ24 ساعة القانونية الخاصة بها) تنتظر بلا داعٍ. الترتيب "الأقدم أولاً" يبقى محفوظاً *داخل*
 * كل شركة (قائمة كل شركة مُرتَّبة سلفاً لأن invoicesDueOldestFirst مُرتَّبة، والتجميع أدناه يحافظ
 * على هذا الترتيب).
 *
 * عندما يتجاوز عدد الشركات صاحبة العمل المعلَّق حجم الدفعة: كل شركة تحصل على فتحة واحدة على الأكثر
 * في هذه النبضة (الجولة الأولى وحدها تملأ الدفعة)، فتُخدَم أول ZATCA_AUTO_RETRY_BATCH_SIZE شركة من
 * قائمة `rotationOffset` الدوّارة هذه النبضة، والباقي ينتظر النبضة التالية. rotationOffset يتقدّم
 * نبضة بعد أخرى (حالة داخل العملية فقط، بلا تأثير على الصحة) حتى لا تُخدَم نفس المجموعة من
 * الشركات دائماً أولاً لو تجاوز عدد الشركات المتنافسة حجم الدفعة باستمرار — كل شركة تتقدّم في
 * الصفّ على مدى عدة نبضات بدل أن تُحرَم إحداها بشكل دائم.
 */
export function allocateZatcaAutoRetryBatch<T extends { companyId: string }>(invoicesDueOldestFirst: T[], batchSize: number, rotationOffset = 0): T[] {
  const byCompany = new Map<string, T[]>();
  for (const invoice of invoicesDueOldestFirst) {
    const queue = byCompany.get(invoice.companyId);
    if (queue) queue.push(invoice);
    else byCompany.set(invoice.companyId, [invoice]);
  }
  const companyQueues = [...byCompany.values()];
  if (companyQueues.length === 0) return [];
  const offset = rotationOffset % companyQueues.length;
  const rotatedQueues = [...companyQueues.slice(offset), ...companyQueues.slice(0, offset)];

  const selected: T[] = [];
  let madeProgress = true;
  while (selected.length < batchSize && madeProgress) {
    madeProgress = false;
    for (const queue of rotatedQueues) {
      if (selected.length >= batchSize) break;
      const next = queue.shift();
      if (next !== undefined) {
        selected.push(next);
        madeProgress = true;
      }
    }
  }
  return selected;
}

// يدوّر أولوية الشركات بين نبضة وأخرى عند التنافس على الدفعة (راجع allocateZatcaAutoRetryBatch) —
// حالة داخل العملية فقط لا تؤثر على الصحة إطلاقاً (مجرد عدالة أفضل عبر الزمن)، تُصفَّر بإعادة تشغيل
// الخادم بلا أي مشكلة.
let zatcaAutoRetryRotationOffset = 0;

/**
 * يُستدعى دورياً من lib/zatca/retryScheduler.ts — يفحص كل الفواتير المُرحَّلة (لأي شركة على
 * المنصّة، بلا اقتصار على مستأجر واحد؛ هذا job خلفي بلا سياق طلب) التي لم تصل لزاتكا بنجاح بعد
 * (تعذّر اتصال، أو لم تُرسَل أصلاً بسبب غياب شهادة الشركة وقت الترحيل) ويعيد محاولة إرسالها بشهادة
 * *شركتها هي* تحديداً (invoice.company عبر invoiceInclude) — لا مشاركة حالة بين الشركات. لا يمسّ
 * القيد المحاسبي ولا حالة ترحيل الفاتورة إطلاقاً (نهائية بصرف النظر عن نتيجة زاتكا) — فقط حقول
 * زاتكا. فشل فاتورة واحدة (استثناء غير متوقَّع، شهادة شركة أُلغيت أو انتهت، ...) لا يوقف بقية
 * الدفعة (شركات أخرى ضمنها) ولا الوظيفة الدورية نفسها.
 *
 * أمان تعدّد النُّسخ (Railway قد يُشغِّل أكثر من Instance): قبل أي محاولة فعلية لفاتورة، تُحجَز
 * ذرّياً عبر claimInvoiceForZatcaAttempt (نفس أسلوب المطالبة الذرّية في reportScheduler.ts أعلاه
 * بـlastSentPeriodKey) — لو نسخة أخرى من الخادم حجزت نفس الفاتورة أولاً (أو غيّرت حالتها) بين
 * قراءتنا وتحديثنا، الحجز يُطابِق صفراً من الصفوف فنتخطّى الفاتورة هذه النبضة بدل إرسالها مرتين.
 * الحجز يحدث *قبل* أي اتصال فعلي بزاتكا، فانهيار العملية بعده مباشرة (قبل استدعاء fetch) لا يترك
 * أثراً غير محاولة مؤجَّلة فقط. النافذة الوحيدة غير المُغلَقة فعلياً: انهيار العملية بعد أن يستلم
 * زاتكا الطلب فعلياً وقبل أن يُكتَب نجاح ذلك محلياً — عندها ستُعاد المحاولة لاحقاً بنفس UUID/تجزئة
 * المستند بالضبط؛ هذا الكود لا يفترض أن زاتكا يتعامل مع ذلك كطلب مكرر آمن (idempotent)، فهذه نافذة
 * خطر متبقية فعلياً، ولا توجد في هذا التكامل أي نقطة API للتحقق من حالة مستند سبق إرساله قبل إعادة
 * إرساله. performZatcaResubmission يُسجِّل تحذيراً مميَّزاً REPEATED SUBMISSION قبل أي محاولة
 * ثانية أو لاحقة لنفس المستند (retryCount > 0) بمعرّفه (UUID) بالضبط، تحديداً لتتبّع هذه الحالة.
 *
 * عدالة بين المستأجرين: الفواتير المستحقة تُوزَّع بالتناوب على الشركات صاحبة العمل المعلَّق (راجع
 * allocateZatcaAutoRetryBatch) بدل ملء الدفعة كلها من أقدم الفواتير على الإطلاق بصرف النظر عن
 * الشركة — فتراكم كبير لشركة واحدة لا يدفع فاتورة شركة أخرى (ربما أقرب فعلياً لمهلتها الخاصة)
 * خارج الدفعة باستمرار.
 */
export async function runZatcaAutoRetry(now: Date = new Date()): Promise<ZatcaAutoRetryRunSummary> {
  const candidates = await prisma.salesInvoice.findMany({
    where: { status: "posted", zatcaStatus: { in: [...ZATCA_AUTO_RETRY_STATUSES] } },
    orderBy: { zatcaSubmittedAt: "asc" }, // الأقدم أولاً داخل كل شركة — الأقرب لمهلة الـ24 ساعة القانونية لتلك الشركة
    take: ZATCA_AUTO_RETRY_QUERY_LIMIT,
    include: invoiceInclude,
  });
  const due = candidates.filter((invoice) => isDueForZatcaAutoRetry(invoice, now));
  const batch = allocateZatcaAutoRetryBatch(due, ZATCA_AUTO_RETRY_BATCH_SIZE, zatcaAutoRetryRotationOffset++);

  const summary: ZatcaAutoRetryRunSummary = { attempted: 0, succeeded: 0, rejected: 0, stillFailing: 0 };
  for (const invoice of batch) {
    const claimed = await claimInvoiceForZatcaAttempt(invoice, now);
    if (!claimed) continue; // نسخة أخرى من الخادم سبقتنا لهذه الفاتورة، أو تغيّرت حالتها منذ القراءة أعلاه

    summary.attempted++;
    try {
      const { updated } = await performZatcaResubmission(invoice);
      if (updated.zatcaStatus === "cleared" || updated.zatcaStatus === "reported") summary.succeeded++;
      else if (updated.zatcaStatus === "rejected") summary.rejected++;
      else summary.stillFailing++;
    } catch (err) {
      summary.stillFailing++;
      // eslint-disable-next-line no-console
      console.error(`[zatcaAutoRetry] فشلت محاولة إعادة إرسال الفاتورة ${invoice.invoiceNumber} (${invoice.id}):`, err);
      // وقت الحجز أعلاه (zatcaLastAttemptAt = now) يكفي وحده لتفعيل الانتظار (backoff) حتى لو
      // فشلت المحاولة هنا محلياً قبل الوصول لزاتكا فعلياً (مثال: الشركة لم تُهيّئ شهادتها بعد) —
      // فقط نزيد العدّاد هنا لتصعيد مدة الانتظار في المرة التالية.
      await prisma.salesInvoice
        .update({ where: { id: invoice.id }, data: { zatcaRetryCount: { increment: 1 } } })
        .catch((updateErr) => console.error(`[zatcaAutoRetry] تعذّر تحديث عدّاد المحاولات للفاتورة ${invoice.invoiceNumber}:`, updateErr));
    }
  }
  return summary;
}

export async function unpostSalesInvoice(tenantId: string, userId: string, id: string, pin: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("الفاتورة ليست مرحّلة أصلاً");
  // فك الترحيل بعد دخول الفاتورة في سلسلة تجزئة زاتكا (ICV/PIH) يكسر السلسلة بلا رجعة — انتهاك
  // امتثال حقيقي لا مجرد إزعاج بالواجهة، فيُمنَع كلياً بمجرد تجاوز الحالة "not_applicable".
  if (invoice.zatcaStatus !== "not_applicable") {
    throw badRequest("لا يمكن فك ترحيل فاتورة مرتبطة بسلسلة تجزئة زاتكا (ICV/PIH) — هذا يكسر السلسلة بشكل غير قابل للإصلاح");
  }

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await reverseTrainerCommissionsTx(tx, id);
    await removeStockOutSideEffectsTx(tx, id);
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
