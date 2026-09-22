import { assertReturnLimits } from "./returnLimits";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine } from "../../lib/invoiceLine";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { reserveZatcaChain, rebuildZatcaDocumentXml, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "../../lib/zatca/chain";
import { submitZatcaChainDocument } from "../../lib/zatca/postingGate";
import { newQueryCounter, counted, logPostingPhaseTiming } from "../../lib/zatca/postingInstrumentation";

/**
 * إشعار دائن (SalesReturn) مرتبط بزاتكا يتطلب رقم الفاتورة الأصلية (BillingReference) — لا نُصدر
 * ICV/تجزئة لمردود بلا فاتورة مرتبطة محدَّدة (relatedInvoiceId فارغ)، فيبقى الحقل "غير منطبق"
 * حتى تُربط لاحقاً؛ هذا لا يمنع الاستخدام المحاسبي العادي للمردود إطلاقاً.
 *
 * الفاتورة المرتبطة يجب أن تكون "posted" فعلياً — لا مسودة (لم تُرقَّم/تُقيَّد بعد)، ولا
 * pending_submission/zatca_accepted_posting_incomplete (سلسلة ICV/PIH حُجزت وربما رُسِلت لزاتكا،
 * لكن لا قيد محاسبي بعد ولا ضمان أن زاتكا خلَّصتها أصلاً) — إصدار إشعار دائن يُشير لرقم فاتورة
 * لم تُخلَّص/تُقيَّد بعد يخالف BR-KSA-17 (الإشعار يجب أن يشير لمستند صادر فعلياً) ويُنتِج فجوة محاسبية
 * حقيقية إن رُفضت الفاتورة الأصلية لاحقاً فلم تُقيَّد أبداً بينما إشعار الدائن عليها مُقيَّد بالفعل.
 */
async function resolveBillingReferenceNumber(tenantId: string, relatedInvoiceId: string | null | undefined): Promise<string | undefined> {
  if (!relatedInvoiceId) return undefined;
  const relatedInvoice = await prisma.salesInvoice.findFirst({ where: { id: relatedInvoiceId, tenantId }, select: { invoiceNumber: true, status: true } });
  if (!relatedInvoice) throw badRequest("الفاتورة الأصلية غير موجودة");
  if (relatedInvoice.status !== "posted") {
    throw badRequest("لا يمكن إصدار إشعار دائن لفاتورة لم تُرحَّل بعد — الفاتورة الأصلية إما مسودة أو لا تزال قيد معالجة زاتكا (في انتظار الإرسال أو لم يكتمل ترحيلها المحلي بعد)");
  }
  return relatedInvoice.invoiceNumber;
}

/**
 * لشركة مرتبطة فعلياً بزاتكا (compliance أو production — أي زاتكا "تنطبق" عليها ولو بشهادة اختبار)،
 * إشعار الدائن بلا فاتورة أصلية مرتبطة لا يُرسَل لزاتكا إطلاقاً (zatcaStatus=not_applicable، راجع
 * تعليق resolveBillingReferenceNumber أعلاه) — وهذا يعني أن الشركة قد "تُصدر" إشعارات دائن حقيقية
 * دون إبلاغ زاتكا بها إطلاقاً رغم التزامها بالإبلاغ، وهي ثغرة امتثال صامتة. لشركة لم تُربَط بزاتكا
 * بعد، مردود محاسبي داخلي بلا فاتورة أصلية أداة دفترية مشروعة تماماً؛ هذا القيد لا يمسّها.
 */
function assertCreditNoteRequiredFieldsForOnboardedCompany(
  company: { zatcaOnboardingStatus: string },
  relatedInvoiceId: string | null | undefined,
  reason: string | null | undefined,
): void {
  if (company.zatcaOnboardingStatus === "not_onboarded") return;
  if (!relatedInvoiceId || !reason?.trim()) {
    throw badRequest(
      "الفاتورة الأصلية وسبب الإصدار إلزاميان لإشعار الدائن لشركة مرتبطة بزاتكا — إشعار دائن بلا فاتورة أصلية مرتبطة لن يُرسَل لزاتكا إطلاقاً، وهذا غير مسموح لشركة مُلزَمة بالإبلاغ",
    );
  }
}

interface LineInput {
  originalInvoiceLineId?: string;
  vatApplicable?: boolean;
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

type SalesReturnWithZatcaChain = Prisma.SalesReturnGetPayload<{ include: typeof returnInclude }>;

/** شكل إعادة موحَّد — راجع InvoicePostingOutcome في salesInvoices.service.ts لنفس السبب بالضبط:
 * حقول المردود دائماً موجودة، والحقول الإضافية اختيارية بحسب ما حدث تحديداً. */
type SalesReturnPostingOutcome = SalesReturnWithZatcaChain & {
  rejectionReason?: string;
  postingIncomplete?: boolean;
};

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

function buildReturnJournalLines(
  computed: Array<{ accountId: string; subtotal: number }>,
  customerId: string,
  vatOutputId: string,
  vatTotal: number,
  creditAccountId: string,
  grandTotal: number,
) {
  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));
  return [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: amount, credit: 0, customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: vatTotal, credit: 0, customerId },
    { accountId: creditAccountId, department: "المالية والحسابات", debit: 0, credit: grandTotal, customerId },
  ];
}

async function resolveCreditAccountId(tenantId: string, companyId: string, customer: { id: string; accountId: string | null; name: string }, refundMethod: string) {
  return refundMethod === "account"
    ? resolvePartyAccountId(tenantId, companyId, customer, REFUND_ACCOUNT_NAME.account)
    : getAccountIdByName(tenantId, companyId, REFUND_ACCOUNT_NAME[refundMethod] ?? REFUND_ACCOUNT_NAME.account);
}

async function validateLinkedReturn(tx: Prisma.TransactionClient, tenantId: string, companyId: string, customerId: string, invoiceId: string | null | undefined,
  lines: { originalInvoiceLineId?: string | null; accountId: string; quantity: unknown }[], total: number, excludeId?: string) {
  if (!invoiceId) return;
  await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${invoiceId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  const invoice = await tx.salesInvoice.findFirst({ where: { id: invoiceId, tenantId, companyId, customerId }, include: { lines: true } });
  if (!invoice || invoice.status !== "posted") throw badRequest("الفاتورة الأصلية لا تخص العميل والشركة المحددين أو غير مرحلة");
  const previous = await tx.salesReturn.findMany({ where: { tenantId, relatedInvoiceId: invoiceId, ...(excludeId ? { id: { not: excludeId } } : {}) }, include: { lines: true } });
  assertReturnLimits(invoice, previous, lines, total);
}

export async function createSalesReturn(tenantId: string, userId: string, input: ReturnInput): Promise<SalesReturnPostingOutcome> {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: input.companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");
  assertCreditNoteRequiredFieldsForOnboardedCompany(company, input.relatedInvoiceId, input.reason);

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId: input.companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");

  const original = input.relatedInvoiceId ? await prisma.salesInvoice.findFirst({ where: { id: input.relatedInvoiceId, tenantId, companyId: input.companyId, customerId: input.customerId }, include: { lines: true } }) : null;
  if (input.relatedInvoiceId && !original) throw badRequest("الفاتورة الأصلية لا تخص العميل والشركة المحددين");
  const billingReferenceId = await resolveBillingReferenceNumber(tenantId, input.relatedInvoiceId);
  const computed = input.lines.map(({ vatApplicable, ...l }) => {
    const source = l.originalInvoiceLineId ? original?.lines.find((line) => line.id === l.originalInvoiceLineId) : null;
    if (input.relatedInvoiceId && !source) throw badRequest("أحد أصناف المرتجع لا ينتمي إلى الفاتورة الأصلية");
    const taxable = source ? source.vatApplicable : vatApplicable;
    if (source) l = { ...l, accountId: source.accountId, description: source.description || undefined, unitPrice: Number(source.unitPrice), discountPct: Number(source.discountPct), priceIncludesVat: source.priceIncludesVat };
    return { ...l, ...computeInvoiceLine({ ...l, vatApplicable: taxable }), taxCategoryCode: source?.taxCategoryCode ?? (taxable === false ? "O" as const : "S" as const), taxExemptionReason: source?.taxExemptionReason ?? null };
  });
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  if (grandTotal <= 0) throw badRequest("إجمالي المردود يجب أن يكون أكبر من صفر");

  const zatcaUuid = randomUUID();
  // BR-KSA-17: إلزامي لإشعار الدائن كلما ارتبط بفاتورة أصلية فعلياً (عندئذٍ فقط يُرسَل لزاتكا) —
  // مردود بلا فاتورة أصلية مرتبطة يبقى مستنداً محاسبياً داخلياً بحتاً (zatcaStatus=not_applicable)،
  // فلا يحتاج سبباً إلزامياً لزاتكا لأنه لن يصلها إطلاقاً.
  const issuanceReason = input.reason?.trim();
  if (billingReferenceId && !issuanceReason) {
    throw badRequest("سبب إصدار إشعار الدائن (BR-KSA-17) إلزامي عند ربطه بفاتورة أصلية سترسَل لزاتكا");
  }

  const vatOutputId = await getAccountIdByName(tenantId, input.companyId, "ضريبة القيمة المضافة - مخرجات");
  const creditAccountId = await resolveCreditAccountId(tenantId, input.companyId, customer, input.refundMethod);
  const journalLines = buildReturnJournalLines(computed, input.customerId, vatOutputId, vatTotal, creditAccountId, grandTotal);
  const zatcaLines: ZatcaPersistedLineLike[] = computed.map((l) => ({ ...l, description: l.description ?? null }));

  // المرحلة 1 — معاملة قصيرة واحدة: تحجز رقم المردود وسلسلة ICV/PIH (إن انطبقت زاتكا) وتكتب
  // الصف وسطوره فوراً، بلا أي اتصال شبكي بزاتكا هنا إطلاقاً.
  const counter1 = newQueryCounter();
  const startedAt1 = Date.now();
  let phase1Outcome: "committed" | "failed" = "failed";
  let phase1: { kind: "done"; salesReturn: SalesReturnWithZatcaChain } | { kind: "pending"; salesReturn: SalesReturnWithZatcaChain; xml: string; subtype: "standard" | "simplified" };
  try {
    phase1 = await prisma.$transaction(async (tx) => {
      await validateLinkedReturn(tx, tenantId, input.companyId, input.customerId, input.relatedInvoiceId, computed, grandTotal);
      const returnNumber = await counted(counter1, reserveDocumentNumber(tx, tenantId, input.companyId, "sales_return"));
      const chain = billingReferenceId
        ? await counted(
            counter1,
            reserveZatcaChain(tx, {
              company, customer, kind: "credit_note", documentNumber: returnNumber, documentUuid: zatcaUuid,
              billingReferenceId, issuanceReason, lines: zatcaLines,
            }),
          )
        : null;
      const baseData = {
        tenantId, returnNumber, companyId: input.companyId, customerId: input.customerId,
        relatedInvoiceId: input.relatedInvoiceId, reason: input.reason, refundMethod: input.refundMethod, date: input.date,
        zatcaUuid, subtotal, vatTotal, grandTotal, lines: { create: computed },
      };
      if (!chain) {
        const entry = await counted(counter1, createJournalEntryTx(tx, {
          tenantId, companyId: input.companyId, date: input.date, memo: `مردود مبيعات ${returnNumber} — ${customer.name}`,
          sourceModule: "sales_return", createdBy: userId, lines: journalLines,
        }));
        const salesReturn = await counted(counter1, tx.salesReturn.create({
          data: { ...baseData, status: "posted", journalEntryId: entry.id, zatcaStatus: "not_applicable" },
          include: returnInclude,
        }));
        await counted(counter1, tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: salesReturn.id } }));
        return { kind: "done" as const, salesReturn };
      }
      const salesReturn = await counted(counter1, tx.salesReturn.create({
        data: {
          ...baseData, status: "pending_submission", icv: chain.icv, previousInvoiceHash: chain.previousInvoiceHash,
          invoiceHash: chain.invoiceHash, zatcaStatus: "not_submitted", zatcaSubmittedAt: chain.issuedAt,
        },
        include: returnInclude,
      }));
      return { kind: "pending" as const, salesReturn, xml: chain.xml, subtype: chain.subtype };
    }, { timeout: 8000 });
    phase1Outcome = "committed";
  } finally {
    logPostingPhaseTiming({ phase: "1", kind: "credit_note", startedAt: startedAt1, counter: counter1, outcome: phase1Outcome });
  }

  if (phase1.kind === "done") return phase1.salesReturn;
  return finishCreditNoteZatcaSubmission(tenantId, userId, {
    salesReturn: phase1.salesReturn, xml: phase1.xml, subtype: phase1.subtype, company, grandTotal, vatTotal, journalLines,
  });
}

/** جلب مردود واحد كاملاً بمعرّفه — لشاشة عرض إشعار الدائن (نفس نمط getSalesInvoice تماماً)،
 * لا نقطة نهاية GET /:id كانت موجودة لمردودات المبيعات قبل هذا. relatedInvoiceId حقل خام بلا
 * علاقة Prisma معرَّفة (راجع schema.prisma — لا @relation عليه)، فالفاتورة الأصلية (رقمها/تاريخها/
 * إجماليها، لعرضها كرابط في شاشة العرض) تُجلَب هنا بجلب إضافي منفصل بدل include، بلا أي تعديل
 * على المخطط (schema) أو أي منطق زاتكا — قراءة عرض بحتة.
 *
 * SalesReturnLine (خلافاً لـSalesInvoiceLine) لا يحمل itemId إطلاقاً — لا رابط "كرت الصنف" مباشر
 * لسطر مردود. لسطر مأخوذ فعلياً من فاتورة أصلية (originalInvoiceLineId)، يُشتق itemId هنا بمطابقته
 * بسطر تلك الفاتورة (نفس الفاتورة المجلوبة أعلاه لهذا الغرض بالضبط)؛ سطر بلا originalInvoiceLineId
 * (مردود داخلي/سطر أُضيف يدوياً) يبقى بلا رابط صنف، لا خطأ. */
export async function getSalesReturn(tenantId: string, id: string) {
  const salesReturn = await prisma.salesReturn.findFirst({ where: { id, tenantId }, include: returnInclude });
  if (!salesReturn) throw notFound("المردود غير موجود");
  const relatedInvoice = salesReturn.relatedInvoiceId
    ? await prisma.salesInvoice.findFirst({
        where: { id: salesReturn.relatedInvoiceId, tenantId },
        select: { id: true, invoiceNumber: true, date: true, grandTotal: true },
      })
    : null;
  const originalLines = salesReturn.relatedInvoiceId
    ? await prisma.salesInvoiceLine.findMany({
        where: { invoiceId: salesReturn.relatedInvoiceId },
        select: { id: true, itemId: true },
      })
    : [];
  const itemIdByOriginalLineId = new Map(originalLines.map((l) => [l.id, l.itemId]));
  const lines = salesReturn.lines.map((l) => ({
    ...l,
    itemId: l.originalInvoiceLineId ? itemIdByOriginalLineId.get(l.originalInvoiceLineId) ?? null : null,
  }));
  return { ...salesReturn, lines, relatedInvoice };
}

/**
 * تعديل مسودة مردود (بعد فك ترحيل — راجع unpostSalesReturn: لا يُسمَح بفكّ ترحيل مردود مرتبط
 * بسلسلة زاتكا أصلاً، فأي "مسودة" هنا zatcaStatus=not_applicable دائماً وbلا قيد محاسبي بعد) —
 * يُحدِّث بيانات الصف وسطوره فقط، بلا أي حجز/إرسال زاتكا (ذلك حصراً في postSalesReturn المنفصلة
 * أدناه، بنفس فصل المسؤوليتين تماماً في updateSalesInvoice/postSalesInvoice).
 */
export async function updateSalesReturn(tenantId: string, id: string, input: ReturnInput): Promise<SalesReturnWithZatcaChain> {
  const existing = await prisma.salesReturn.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("المردود غير موجود");
  if (existing.status !== "draft") throw badRequest("لا يمكن تعديل مردود مرحّل، يجب فك ترحيله أولاً");

  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: input.companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");
  assertCreditNoteRequiredFieldsForOnboardedCompany(company, input.relatedInvoiceId, input.reason);

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId: input.companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");

  const original = input.relatedInvoiceId
    ? await prisma.salesInvoice.findFirst({ where: { id: input.relatedInvoiceId, tenantId, companyId: input.companyId, customerId: input.customerId }, include: { lines: true } })
    : null;
  if (input.relatedInvoiceId && !original) throw badRequest("الفاتورة الأصلية لا تخص العميل والشركة المحددين");
  const billingReferenceId = await resolveBillingReferenceNumber(tenantId, input.relatedInvoiceId);
  const computed = input.lines.map(({ vatApplicable, ...l }) => {
    const source = l.originalInvoiceLineId ? original?.lines.find((line) => line.id === l.originalInvoiceLineId) : null;
    if (input.relatedInvoiceId && !source) throw badRequest("أحد أصناف المرتجع لا ينتمي إلى الفاتورة الأصلية");
    const taxable = source ? source.vatApplicable : vatApplicable;
    if (source) l = { ...l, accountId: source.accountId, description: source.description || undefined, unitPrice: Number(source.unitPrice), discountPct: Number(source.discountPct), priceIncludesVat: source.priceIncludesVat };
    return { ...l, ...computeInvoiceLine({ ...l, vatApplicable: taxable }), taxCategoryCode: source?.taxCategoryCode ?? (taxable === false ? "O" as const : "S" as const), taxExemptionReason: source?.taxExemptionReason ?? null };
  });
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  if (grandTotal <= 0) throw badRequest("إجمالي المردود يجب أن يكون أكبر من صفر");

  const issuanceReason = input.reason?.trim();
  if (billingReferenceId && !issuanceReason) {
    throw badRequest("سبب إصدار إشعار الدائن (BR-KSA-17) إلزامي عند ربطه بفاتورة أصلية سترسَل لزاتكا");
  }

  return prisma.$transaction(async (tx) => {
    await validateLinkedReturn(tx, tenantId, input.companyId, input.customerId, input.relatedInvoiceId, computed, grandTotal, id);
    await tx.salesReturnLine.deleteMany({ where: { returnId: id } });
    return tx.salesReturn.update({
      where: { id },
      data: {
        companyId: input.companyId, customerId: input.customerId, relatedInvoiceId: input.relatedInvoiceId ?? null,
        date: input.date, reason: input.reason, refundMethod: input.refundMethod,
        subtotal, vatTotal, grandTotal, lines: { create: computed },
      },
      include: returnInclude,
    });
  });
}

/** المراحل 2 (لا معاملة) + 3أ (تحديث سطر واحد) + 3ب (معاملة منفصلة: القيد فقط، لا مخزون ولا
 * عمولات لمردودات المبيعات) — مُشتركة بين createSalesReturn/postSalesReturn/retryPendingZatcaSubmission. */
async function finishCreditNoteZatcaSubmission(
  tenantId: string,
  userId: string,
  params: {
    salesReturn: SalesReturnWithZatcaChain;
    xml: string;
    subtype: "standard" | "simplified";
    company: ZatcaCompanyLike;
    grandTotal: number;
    vatTotal: number;
    journalLines: ReturnType<typeof buildReturnJournalLines>;
  },
): Promise<SalesReturnPostingOutcome> {
  const { salesReturn, xml, subtype, company, grandTotal, vatTotal, journalLines } = params;

  const decision = await submitZatcaChainDocument({
    company,
    documentNumber: salesReturn.returnNumber,
    documentUuid: salesReturn.zatcaUuid,
    kind: "credit_note",
    chain: {
      xml, subtype, icv: salesReturn.icv!, previousInvoiceHash: salesReturn.previousInvoiceHash!,
      invoiceHash: salesReturn.invoiceHash!, issuedAt: salesReturn.zatcaSubmittedAt!,
    },
    grandTotal, vatTotal,
  });

  const afterResponse = await prisma.salesReturn.update({
    where: { id: salesReturn.id },
    data: {
      zatcaStatus: decision.zatcaFields.zatcaStatus,
      zatcaResponseRaw: (decision.zatcaFields.zatcaResponseRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      zatcaClearedOrReportedAt: decision.zatcaFields.zatcaClearedOrReportedAt,
      status: decision.proceedWithPosting ? "zatca_accepted_posting_incomplete" : "pending_submission",
    },
    include: returnInclude,
  });

  if (!decision.proceedWithPosting) {
    return { ...afterResponse, rejectionReason: decision.rejectionReason };
  }

  try {
    return await completeCreditNoteLocalPosting(tenantId, userId, afterResponse, journalLines);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[zatca-posting-instrumentation] phase=3b kind=credit_note outcome=failed documentUuid=${salesReturn.zatcaUuid} returnNumber=${salesReturn.returnNumber} — سيُكتمَل لاحقاً عبر completeZatcaAcceptedPosting:`,
      err,
    );
    return { ...afterResponse, postingIncomplete: true };
  }
}

async function completeCreditNoteLocalPosting(
  tenantId: string,
  userId: string,
  salesReturn: SalesReturnWithZatcaChain,
  journalLines: ReturnType<typeof buildReturnJournalLines>,
): Promise<SalesReturnPostingOutcome> {
  const counter = newQueryCounter();
  const startedAt = Date.now();
  let outcome: "committed" | "failed" = "failed";
  try {
    const posted = await prisma.$transaction(async (tx) => {
      const entry = await counted(counter, createJournalEntryTx(tx, {
        tenantId, companyId: salesReturn.companyId, date: salesReturn.date,
        memo: `مردود مبيعات ${salesReturn.returnNumber} — ${salesReturn.customer.name}`,
        sourceModule: "sales_return", sourceId: salesReturn.id, createdBy: userId, lines: journalLines,
      }));
      return counted(counter, tx.salesReturn.update({
        where: { id: salesReturn.id }, data: { status: "posted", journalEntryId: entry.id }, include: returnInclude,
      }));
    }, { timeout: 8000 });
    outcome = "committed";
    return posted;
  } finally {
    logPostingPhaseTiming({ phase: "3b", kind: "credit_note", startedAt, counter, outcome });
  }
}

function toComputedReturnLines(lines: SalesReturnWithZatcaChain["lines"]) {
  return lines.map((l) => ({
    accountId: l.accountId,
    subtotal: Number(l.subtotal),
    vat: Number(l.vat),
    total: Number(l.total),
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
  }));
}

function toZatcaReturnLines(lines: SalesReturnWithZatcaChain["lines"]): ZatcaPersistedLineLike[] {
  return lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    subtotal: Number(l.subtotal),
    vat: Number(l.vat),
    taxCategoryCode: l.taxCategoryCode,
    taxExemptionReason: l.taxExemptionReason,
  }));
}

export async function deleteSalesReturn(tenantId: string, id: string) {
  const existing = await prisma.salesReturn.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("المردود غير موجود");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف مردود مرحّل، يجب فك ترحيله أولاً");
  await prisma.salesReturn.delete({ where: { id } });
}

export async function postSalesReturn(tenantId: string, userId: string, id: string): Promise<SalesReturnPostingOutcome> {
  const salesReturn = await prisma.salesReturn.findFirst({ where: { id, tenantId }, include: returnInclude });
  if (!salesReturn) throw notFound("المردود غير موجود");
  if (salesReturn.status === "posted") throw badRequest("المردود مرحّل بالفعل");
  if (salesReturn.status !== "draft") {
    throw badRequest("هذا المردود قيد معالجة زاتكا بالفعل — استخدم إعادة المحاولة أو إكمال الترحيل بدلاً من الترحيل من جديد");
  }
  const company = await prisma.company.findFirstOrThrow({ where: { id: salesReturn.companyId, tenantId } });
  const customer = salesReturn.customer;
  // إعادة الفحص هنا عمداً (لا فقط عند الإنشاء) — الشركة قد تكون كانت غير مرتبطة بزاتكا وقت إنشاء
  // هذا المردود كمسودة، ثم اكتمل ربطها بزاتكا قبل أن يُرحَّل (فك ترحيل/إعادة ترحيل لاحقة مثلاً).
  assertCreditNoteRequiredFieldsForOnboardedCompany(company, salesReturn.relatedInvoiceId, salesReturn.reason);

  const computed = toComputedReturnLines(salesReturn.lines);
  const vatOutputId = await getAccountIdByName(tenantId, salesReturn.companyId, "ضريبة القيمة المضافة - مخرجات");
  const creditAccountId = await resolveCreditAccountId(tenantId, salesReturn.companyId, customer, salesReturn.refundMethod || "account");
  const journalLines = buildReturnJournalLines(computed, salesReturn.customerId, vatOutputId, Number(salesReturn.vatTotal), creditAccountId, Number(salesReturn.grandTotal));
  const billingReferenceId = await resolveBillingReferenceNumber(tenantId, salesReturn.relatedInvoiceId);
  const zatcaUuid = salesReturn.zatcaUuid;

  const counter1 = newQueryCounter();
  const startedAt1 = Date.now();
  let phase1Outcome: "committed" | "failed" = "failed";
  let phase1: { kind: "done"; salesReturn: SalesReturnWithZatcaChain } | { kind: "pending"; salesReturn: SalesReturnWithZatcaChain; xml: string; subtype: "standard" | "simplified" };
  try {
    phase1 = await prisma.$transaction(async (tx) => {
      await validateLinkedReturn(tx, tenantId, salesReturn.companyId, salesReturn.customerId, salesReturn.relatedInvoiceId, salesReturn.lines, Number(salesReturn.grandTotal), salesReturn.id);
      const chain = billingReferenceId
        ? await counted(
            counter1,
            reserveZatcaChain(tx, {
              company, customer, kind: "credit_note", documentNumber: salesReturn.returnNumber, documentUuid: zatcaUuid,
              billingReferenceId, issuanceReason: salesReturn.reason?.trim() || undefined, lines: toZatcaReturnLines(salesReturn.lines),
            }),
          )
        : null;
      if (!chain) {
        const entry = await counted(counter1, createJournalEntryTx(tx, {
          tenantId, companyId: salesReturn.companyId, date: salesReturn.date, memo: `مردود مبيعات ${salesReturn.returnNumber} — ${customer.name}`,
          sourceModule: "sales_return", sourceId: salesReturn.id, createdBy: userId, lines: journalLines,
        }));
        const updated = await counted(counter1, tx.salesReturn.update({
          where: { id }, data: { status: "posted", journalEntryId: entry.id, zatcaStatus: "not_applicable" }, include: returnInclude,
        }));
        return { kind: "done" as const, salesReturn: updated };
      }
      const updated = await counted(counter1, tx.salesReturn.update({
        where: { id },
        data: {
          status: "pending_submission", icv: chain.icv, previousInvoiceHash: chain.previousInvoiceHash,
          invoiceHash: chain.invoiceHash, zatcaStatus: "not_submitted", zatcaSubmittedAt: chain.issuedAt,
        },
        include: returnInclude,
      }));
      return { kind: "pending" as const, salesReturn: updated, xml: chain.xml, subtype: chain.subtype };
    }, { timeout: 8000 });
    phase1Outcome = "committed";
  } finally {
    logPostingPhaseTiming({ phase: "1", kind: "credit_note", startedAt: startedAt1, counter: counter1, outcome: phase1Outcome });
  }

  if (phase1.kind === "done") return phase1.salesReturn;
  return finishCreditNoteZatcaSubmission(tenantId, userId, {
    salesReturn: phase1.salesReturn, xml: phase1.xml, subtype: phase1.subtype, company,
    grandTotal: Number(salesReturn.grandTotal), vatTotal: Number(salesReturn.vatTotal), journalLines,
  });
}

/** إعادة محاولة إرسال مردود عالق بحالة pending_submission — بنفس UUID/ICV/التجزئة المخزَّنة على
 * الصف بالضبط، بلا حجز أي شيء جديد إطلاقاً. راجع retryPendingZatcaSubmission في
 * salesInvoices.service.ts لنفس التصميم بالضبط. */
export async function retryPendingZatcaSubmission(tenantId: string, userId: string, id: string): Promise<SalesReturnPostingOutcome> {
  const salesReturn = await prisma.salesReturn.findFirst({ where: { id, tenantId }, include: returnInclude });
  if (!salesReturn) throw notFound("المردود غير موجود");
  if (salesReturn.status !== "pending_submission") {
    throw badRequest("إعادة المحاولة متاحة فقط لمردود في انتظار الإرسال لزاتكا");
  }
  if (salesReturn.icv == null || !salesReturn.previousInvoiceHash || !salesReturn.invoiceHash || !salesReturn.zatcaSubmittedAt) {
    throw badRequest("بيانات سلسلة زاتكا لهذا المردود غير مكتملة — تعذّرت إعادة المحاولة، راجع الدعم الفني");
  }

  const company = await prisma.company.findFirstOrThrow({ where: { id: salesReturn.companyId, tenantId } });
  const billingReferenceId = await resolveBillingReferenceNumber(tenantId, salesReturn.relatedInvoiceId);
  if (!billingReferenceId) {
    throw badRequest("تعذّرت إعادة المحاولة: الفاتورة الأصلية المرتبطة بهذا الإشعار لم تعد موجودة — راجع الدعم الفني");
  }

  const rebuilt = rebuildZatcaDocumentXml({
    company, customer: salesReturn.customer, kind: "credit_note", documentNumber: salesReturn.returnNumber,
    documentUuid: salesReturn.zatcaUuid, lines: toZatcaReturnLines(salesReturn.lines),
    icv: salesReturn.icv, previousInvoiceHash: salesReturn.previousInvoiceHash, issuedAt: salesReturn.zatcaSubmittedAt,
    billingReferenceId, issuanceReason: salesReturn.reason?.trim() || undefined,
  });
  if (rebuilt.invoiceHash !== salesReturn.invoiceHash) {
    throw badRequest("تعذّرت إعادة المحاولة: بيانات المردود المخزَّنة لا تطابق ما حُجزت له السلسلة أصلاً — راجع الدعم الفني قبل أي محاولة أخرى");
  }

  const computed = toComputedReturnLines(salesReturn.lines);
  const vatOutputId = await getAccountIdByName(tenantId, salesReturn.companyId, "ضريبة القيمة المضافة - مخرجات");
  const creditAccountId = await resolveCreditAccountId(tenantId, salesReturn.companyId, salesReturn.customer, salesReturn.refundMethod || "account");
  const journalLines = buildReturnJournalLines(computed, salesReturn.customerId, vatOutputId, Number(salesReturn.vatTotal), creditAccountId, Number(salesReturn.grandTotal));

  return finishCreditNoteZatcaSubmission(tenantId, userId, {
    salesReturn, xml: rebuilt.xml, subtype: rebuilt.subtype, company,
    grandTotal: Number(salesReturn.grandTotal), vatTotal: Number(salesReturn.vatTotal), journalLines,
  });
}

/** تُكمل الترحيل المحلي (القيد فقط) لمردود استلم ردّاً من زاتكا بالفعل لكن المرحلة 3ب السابقة
 * فشلت — بلا أي اتصال جديد بزاتكا إطلاقاً. */
export async function completeZatcaAcceptedPosting(tenantId: string, userId: string, id: string): Promise<SalesReturnPostingOutcome> {
  const salesReturn = await prisma.salesReturn.findFirst({ where: { id, tenantId }, include: returnInclude });
  if (!salesReturn) throw notFound("المردود غير موجود");
  if (salesReturn.status !== "zatca_accepted_posting_incomplete") {
    throw badRequest("إكمال الترحيل متاح فقط لمردود استلم ردّاً من زاتكا لكن لم يكتمل ترحيله المحلي بعد");
  }
  const computed = toComputedReturnLines(salesReturn.lines);
  const vatOutputId = await getAccountIdByName(tenantId, salesReturn.companyId, "ضريبة القيمة المضافة - مخرجات");
  const creditAccountId = await resolveCreditAccountId(tenantId, salesReturn.companyId, salesReturn.customer, salesReturn.refundMethod || "account");
  const journalLines = buildReturnJournalLines(computed, salesReturn.customerId, vatOutputId, Number(salesReturn.vatTotal), creditAccountId, Number(salesReturn.grandTotal));
  return completeCreditNoteLocalPosting(tenantId, userId, salesReturn, journalLines);
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
