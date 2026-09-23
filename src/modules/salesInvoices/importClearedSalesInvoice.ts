import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { invoiceTypeForCustomer } from "../../lib/invoiceLine";
import { buildZatcaQrPayload } from "../../lib/zatcaQr";
import { createJournalEntryTx } from "../../lib/journalPosting";
import {
  LineInput,
  invoiceInclude,
  assertRefs,
  computeCogsJournalLines,
  createStockOutSideEffectsTx,
  buildJournalLines,
  withPaymentStatus,
} from "./salesInvoices.service";

type ImportedInvoiceWithZatcaChain = Prisma.SalesInvoiceGetPayload<{ include: typeof invoiceInclude }>;
export type ImportedInvoiceResult = ReturnType<typeof withPaymentStatus<ImportedInvoiceWithZatcaChain>>;

/**
 * استيراد فاتورة مبيعات "خلَّصتها زاتكا فعلياً لدى زاتكا نفسها، لكن ضاعت قبل أن تُحفَظ في قاعدتنا"
 * (حادثة [zatcaChainGap]) — تُسجِّل المستند بكل بيانات زاتكا الحقيقية كما وردت من سجلّات زاتكا
 * نفسها (رقم الفاتورة، UUID، ICV، تجزئة المستند)، بلا أي اتصال بزاتكا إطلاقاً هنا: لا توقيع، لا
 * إرسال، لا حجز سلسلة، لا زيادة عدّاد. هذا الملف بالكامل عمداً منفصل عن salesInvoices.service.ts
 * ولا يستورد شيئاً من src/lib/zatca/chain.ts أو postingGate.ts أو submission.ts أو resubmit.ts —
 * أي مراجعة لهذا الملف وحده تكفي لإثبات أنه لا يتصل بزاتكا مطلقاً.
 *
 * الاستخدام الوحيد المقصود: سكربت مستقل (scripts/importClearedInvoices.ts) يُشغَّل يدوياً من مطوّر/
 * محاسب بعد مطابقة سجلات زاتكا يدوياً — بلا أي نقطة نهاية HTTP إطلاقاً (لا تُضِف هذه الدالة إلى أي
 * controller/routes). الفاتورة المستوردة هنا مقصودة لتكون "مكرَّرة" محاسبياً عن قصد (فاتورة أخرى
 * سُجِّلت فعلياً برقم مختلف لنفس البيع) — إشعار دائن حقيقي يُصدَر لاحقاً (ويتصل بزاتكا فعلياً) هو
 * ما يُصفِّر أثرها، لا هذه الدالة.
 */

export interface ImportedLineInput extends LineInput {
  subtotal: number;
  vat: number;
  total: number;
}

export interface ImportClearedInvoiceInput {
  companyId: string;
  customerId: string;
  branchId?: string | null;
  /** رقم الفاتورة كما صدر فعلياً وكما تعرفه زاتكا — لا تُحجَز عبر reserveDocumentNumber هنا (ذلك
   * يُنتِج رقماً جديداً من عدّاد الشركة التالي، بينما هذا الرقم تاريخي فعلي ثابت). */
  invoiceNumber: string;
  date: Date;
  lines: ImportedLineInput[];
  /** إجماليات الفاتورة كما خلَّصتها زاتكا فعلياً — لا تُعاد حسابتها من الأسطر هنا؛ فقط تُتحقَّق
   * اتساقاً (راجع assertAmountsConsistent) لضمان توازن القيد لاحقاً. */
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  /** UUID الفعلي الذي أرسِلته زاتكا وقت التخليص الأصلي — ليس UUID جديداً يُولَّد هنا. */
  zatcaUuid: string;
  /** رقم ICV الفعلي الذي استخدمته زاتكا لهذا المستند تحديداً وقت التخليص — لا يُحجَز من
   * Company.zatcaNextIcv هنا إطلاقاً (راجع assertIcvNotAlreadyUsed وتعليق الدالة الرئيسية). */
  icv: number;
  previousInvoiceHash: string;
  invoiceHash: string;
  zatcaClearedOrReportedAt?: Date;
  /** سبب الاستيراد — إلزامي، يُكتَب في سجل تدقيق (AuditLog) كعلامة صريحة أن هذا المستند "مستورَد
   * من سجلات زاتكا" لا "مُصدَر ومُرسَل من هذا النظام"، مع السبب لأي مراجعة لاحقة. */
  reason: string;
  warehouseId?: string;
}

const AMOUNT_TOLERANCE = 0.01;

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

/**
 * الإجماليات المُرسَلة (subtotal/vatTotal/grandTotal) يجب أن تتّسق فعلياً مع مجموع الأسطر ومع
 * بعضها (subtotal + vatTotal = grandTotal) — لا إعادة حساب هنا (المصدر هو رقم زاتكا الفعلي)، فقط
 * تحقّق: مدخلات غير متّسقة تعني خطأ نسخ من سجل زاتكا، ويجب أن تُرفَض هنا قبل أي كتابة، لا أن تُنتِج
 * قيداً محاسبياً غير متوازن لاحقاً.
 */
function assertAmountsConsistent(input: ImportClearedInvoiceInput): void {
  const linesSubtotal = input.lines.reduce((s, l) => s + l.subtotal, 0);
  const linesVat = input.lines.reduce((s, l) => s + l.vat, 0);
  const linesTotal = input.lines.reduce((s, l) => s + l.total, 0);
  if (!closeEnough(linesSubtotal, input.subtotal)) {
    throw badRequest(`مجموع صافي الأسطر (${linesSubtotal.toFixed(2)}) لا يطابق subtotal المُرسَل (${input.subtotal.toFixed(2)})`);
  }
  if (!closeEnough(linesVat, input.vatTotal)) {
    throw badRequest(`مجموع ضريبة الأسطر (${linesVat.toFixed(2)}) لا يطابق vatTotal المُرسَل (${input.vatTotal.toFixed(2)})`);
  }
  if (!closeEnough(linesTotal, input.grandTotal)) {
    throw badRequest(`مجموع إجمالي الأسطر (${linesTotal.toFixed(2)}) لا يطابق grandTotal المُرسَل (${input.grandTotal.toFixed(2)})`);
  }
  if (!closeEnough(input.subtotal + input.vatTotal, input.grandTotal)) {
    throw badRequest(`subtotal + vatTotal (${(input.subtotal + input.vatTotal).toFixed(2)}) لا يساوي grandTotal (${input.grandTotal.toFixed(2)})`);
  }
  if (input.grandTotal <= 0) throw badRequest("إجمالي الفاتورة المستوردة يجب أن يكون أكبر من صفر");
}

async function assertInvoiceNumberNotUsed(tenantId: string, companyId: string, invoiceNumber: string): Promise<void> {
  const existing = await prisma.salesInvoice.findFirst({ where: { tenantId, companyId, invoiceNumber }, select: { id: true } });
  if (existing) throw badRequest(`رقم الفاتورة "${invoiceNumber}" مستخدَم بالفعل لهذه الشركة`);
}

/**
 * zatcaUuid فريد عالمياً حسب المخطط (@unique) لكن على مستوى كل جدول على حدة فقط — قيد قاعدة
 * البيانات على sales_invoices وحده لا يمنع نفس القيمة من الوجود في sales_returns أو
 * sales_debit_notes، فالتحقّق الفعلي من "غير مستخدَم في أي مكان" يتطلّب فحص الجداول الثلاثة صراحةً.
 */
async function assertZatcaUuidNotUsedAnywhere(zatcaUuid: string): Promise<void> {
  const [inv, ret, debit] = await Promise.all([
    prisma.salesInvoice.findFirst({ where: { zatcaUuid }, select: { id: true } }),
    prisma.salesReturn.findFirst({ where: { zatcaUuid }, select: { id: true } }),
    prisma.salesDebitNote.findFirst({ where: { zatcaUuid }, select: { id: true } }),
  ]);
  if (inv || ret || debit) throw badRequest(`zatcaUuid "${zatcaUuid}" مستخدَم بالفعل في مستند آخر`);
}

/** icv مقيَّد بسلسلة الشركة الواحدة (Company.zatcaNextIcv) لا بمستند بعينه — فريد ضمن الشركة عبر
 * الأنواع الثلاثة (فاتورة/مردود/إشعار مدين) لا داخل sales_invoices فقط. */
async function assertIcvNotAlreadyUsed(tenantId: string, companyId: string, icv: number): Promise<void> {
  const [inv, ret, debit] = await Promise.all([
    prisma.salesInvoice.findFirst({ where: { tenantId, companyId, icv }, select: { id: true } }),
    prisma.salesReturn.findFirst({ where: { tenantId, companyId, icv }, select: { id: true } }),
    prisma.salesDebitNote.findFirst({ where: { tenantId, companyId, icv }, select: { id: true } }),
  ]);
  if (inv || ret || debit) throw badRequest(`رقم ICV (${icv}) مستخدَم بالفعل لمستند آخر ضمن هذه الشركة`);
}

/**
 * يستورد فاتورة "خلَّصتها زاتكا فعلياً" مباشرة إلى قاعدة البيانات بحالة posted/cleared (أو
 * reported لفاتورة مبسّطة)، بقيد محاسبي وحركات مخزون كاملتين تماماً كفاتورة عادية مُرحَّلة — حتى
 * تبقى الدفاتر متّسقة ويُصفِّر إشعار الدائن اللاحق (الذي يتصل بزاتكا فعلياً) أثرها بدقة. لا اتصال
 * بزاتكا هنا بأي شكل: invoiceType يُشتَق من بيانات العميل الحالية (invoiceTypeForCustomer) لا من
 * مُدخَل منفصل — يضمن هذا تطابقه تلقائياً مع ما سيشتقّه إشعار الدائن لاحقاً لنفس العميل (راجع قاعدة
 * تطابق subtype في PR #82، validateLinkedReturn في salesReturns.service.ts)، بدل الاعتماد على أن
 * القيمة المُرسَلة يدوياً من سجل زاتكا لم تنحرف عن العميل الحالي.
 */
export interface ImportClearedInvoicePreview {
  dryRun: true;
  wouldCreate: {
    invoiceNumber: string;
    customerName: string;
    invoiceType: "standard" | "simplified";
    zatcaStatus: "cleared" | "reported";
    grandTotal: number;
    linesCount: number;
  };
}

/** كل التحقّقات (اتساق المبالغ، وجود العميل/الحسابات/الأصناف، كفاية المخزون، عدم تكرار رقم
 * الفاتورة/zatcaUuid/icv) تُنفَّذ حتى في وضع المعاينة (dryRun) — فقط الكتابة الفعلية (المعاملة)
 * تُتخطى. راجع تعليق الدالة نفسها أدناه لباقي التفاصيل. */
export async function importClearedSalesInvoice(
  tenantId: string,
  userId: string,
  input: ImportClearedInvoiceInput,
  options: { dryRun?: boolean } = {},
): Promise<ImportClearedInvoicePreview | ImportedInvoiceResult> {
  assertAmountsConsistent(input);

  const { customer, company } = await assertRefs(tenantId, input.companyId, input.customerId, input.lines, input.branchId);

  await assertInvoiceNumberNotUsed(tenantId, input.companyId, input.invoiceNumber);
  await assertZatcaUuidNotUsedAnywhere(input.zatcaUuid);
  await assertIcvNotAlreadyUsed(tenantId, input.companyId, input.icv);

  const invoiceType = invoiceTypeForCustomer(customer);
  const zatcaStatus = invoiceType === "standard" ? ("cleared" as const) : ("reported" as const);

  const qrPayload = buildZatcaQrPayload(
    company.name,
    company.vatNumber || "",
    `${input.date.toISOString().slice(0, 10)}T12:00:00`,
    input.grandTotal,
    input.vatTotal,
  );

  const computed = input.lines.map((l) => ({
    accountId: l.accountId,
    itemId: l.itemId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPct: l.discountPct ?? 0,
    priceIncludesVat: l.priceIncludesVat ?? false,
    vatApplicable: l.vatApplicable ?? true,
    taxCategoryCode: l.vatApplicable === false ? ("O" as const) : ("S" as const),
    taxExemptionReason: null as string | null,
    subtotal: l.subtotal,
    vat: l.vat,
    total: l.total,
  }));

  const { cogsLines, itemById } = await computeCogsJournalLines(tenantId, input.companyId, input.lines, input.warehouseId);
  const journalLines = await buildJournalLines(tenantId, input.companyId, customer, computed, input.vatTotal, input.grandTotal, cogsLines);
  const zatcaClearedOrReportedAt = input.zatcaClearedOrReportedAt ?? input.date;

  if (options.dryRun) {
    return {
      dryRun: true as const,
      wouldCreate: {
        invoiceNumber: input.invoiceNumber,
        customerName: customer.name,
        invoiceType,
        zatcaStatus,
        grandTotal: input.grandTotal,
        linesCount: computed.length,
      },
    };
  }

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      branchId: input.branchId || undefined,
      date: input.date,
      memo: `استيراد فاتورة مخلَّصة من زاتكا ${input.invoiceNumber} — ${customer.name}`,
      sourceModule: "sales_invoice",
      createdBy: userId,
      lines: journalLines,
    });
    const invoice = await tx.salesInvoice.create({
      data: {
        tenantId,
        invoiceNumber: input.invoiceNumber,
        companyId: input.companyId,
        customerId: input.customerId,
        branchId: input.branchId || undefined,
        date: input.date,
        invoiceType,
        status: "posted",
        journalEntryId: entry.id,
        qrPayload,
        subtotal: input.subtotal,
        vatTotal: input.vatTotal,
        grandTotal: input.grandTotal,
        zatcaUuid: input.zatcaUuid,
        icv: input.icv,
        previousInvoiceHash: input.previousInvoiceHash,
        invoiceHash: input.invoiceHash,
        zatcaStatus,
        zatcaSubmittedAt: zatcaClearedOrReportedAt,
        zatcaClearedOrReportedAt,
        lines: { create: computed },
      },
      include: invoiceInclude,
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: invoice.id } });
    await createStockOutSideEffectsTx(tx, tenantId, input.companyId, input.date, invoice.lines, entry.id, itemById, input.warehouseId);

    // العلامة الصريحة المطلوبة: هذا المستند "مُستورَد من سجلات زاتكا"، لا مُصدَراً ومُرسَلاً من هذا
    // النظام — راجع تعليق الملف. سجل تدقيق عام (AuditLog)، لا عمود جديد على SalesInvoice (بلا أي
    // migration لهذه الميزة، راجع تقرير الخطوة 1).
    await tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "sales_invoice.imported_from_zatca",
        entityType: "SalesInvoice",
        entityId: invoice.id,
        metadata: {
          reason: input.reason,
          invoiceNumber: input.invoiceNumber,
          zatcaUuid: input.zatcaUuid,
          icv: input.icv,
        } as Prisma.InputJsonValue,
      },
    });

    return withPaymentStatus(invoice);
  });
}
