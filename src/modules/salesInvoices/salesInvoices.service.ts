import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine, invoiceTypeForCustomer } from "../../lib/invoiceLine";
import { buildZatcaQrPayload } from "../../lib/zatcaQr";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { formatDocNumber } from "../../lib/docNumber";
import { getStockBalance } from "../stockMovements/stockMovements.service";
import { isStockTracked } from "../items/items.service";
import { evaluateZatcaPostingGate } from "../../lib/zatca/postingGate";

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
  date: Date;
  lines: LineInput[];
  post?: boolean;
}

const invoiceInclude = {
  lines: { include: { account: true } },
  customer: true,
  company: true,
  receiptAllocations: true,
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
  return { company, customer };
}

/** يبني سطور قيد تكلفة البضاعة المباعة (لو فيه أصناف مخزونية بالفاتورة)، ويتحقق من كفاية الرصيد قبل الترحيل — لا يكتب أي شيء لقاعدة البيانات، للاستدعاء قبل بناء القيد. */
async function computeCogsJournalLines(tenantId: string, companyId: string, lines: LineInput[]) {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  if (!itemIds.length) return [];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const stockLines = lines.filter((l) => l.itemId && isStockTracked(itemById.get(l.itemId)!.type));
  if (!stockLines.length) return [];

  const warehouse = await prisma.warehouse.findFirst({ where: { tenantId, companyId, isDefault: true } });
  if (!warehouse) throw badRequest("لا يوجد مستودع افتراضي محدد لهذه الشركة؛ حدّده من شاشة المستودعات أولاً");

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
) {
  const itemIds = persistedLines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  if (!itemIds.length) return;
  const warehouse = await tx.warehouse.findFirst({ where: { tenantId, companyId, isDefault: true } });
  if (!warehouse) throw badRequest("لا يوجد مستودع افتراضي محدد لهذه الشركة؛ حدّده من شاشة المستودعات أولاً");

  for (const line of persistedLines) {
    if (!line.itemId) continue;
    const item = await tx.item.findFirstOrThrow({ where: { id: line.itemId, tenantId } });
    if (!isStockTracked(item.type)) continue;
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

export async function getSalesInvoice(tenantId: string, id: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  return withPaymentStatus(invoice);
}

async function buildJournalLines(
  tenantId: string,
  companyId: string,
  customerId: string,
  computed: Array<LineInput & { subtotal: number; vat: number; total: number }>,
  vatTotal: number,
  grandTotal: number,
  cogsLines: Array<{ accountId: string; department: string; debit: number; credit: number }> = [],
) {
  const vatOutputId = await getAccountIdByName(tenantId, companyId, "ضريبة القيمة المضافة - مخرجات");
  const receivableId = await getAccountIdByName(tenantId, companyId, "ذمم مدينة");
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

  const shouldPost = input.post !== false;

  if (!shouldPost) {
    const invoice = await prisma.salesInvoice.create({
      data: {
        tenantId,
        invoiceNumber,
        companyId: input.companyId,
        customerId: input.customerId,
        date: input.date,
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
    return withPaymentStatus(invoice);
  }

  const cogsLines = await computeCogsJournalLines(tenantId, input.companyId, input.lines);
  const journalLines = await buildJournalLines(tenantId, input.companyId, input.customerId, computed, vatTotal, grandTotal, cogsLines);
  const zatcaUuid = randomUUID();

  return prisma.$transaction(async (tx) => {
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
    await createStockOutSideEffectsTx(tx, tenantId, input.companyId, input.date, invoice.lines, entry.id);

    return withPaymentStatus(invoice);
  });
}

export async function updateSalesInvoice(tenantId: string, id: string, input: InvoiceInput) {
  const existing = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن تعديل فاتورة مرحّلة، يجب فك ترحيلها أولاً");

  input = { ...input, lines: await resolveLineAccounts(tenantId, input.companyId, input.lines) };
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
  const company = await prisma.company.findFirstOrThrow({ where: { id: invoice.companyId, tenantId } });

  const computed = invoice.lines.map((l) => ({
    accountId: l.accountId, itemId: l.itemId ?? undefined, subtotal: Number(l.subtotal), vat: Number(l.vat), total: Number(l.total),
    quantity: Number(l.quantity), unitPrice: Number(l.unitPrice),
  }));
  const cogsLines = await computeCogsJournalLines(tenantId, invoice.companyId, computed);
  const journalLines = await buildJournalLines(tenantId, invoice.companyId, invoice.customerId, computed, Number(invoice.vatTotal), Number(invoice.grandTotal), cogsLines);

  return prisma.$transaction(async (tx) => {
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

    return withPaymentStatus(updated);
  });
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
