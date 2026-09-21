import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine } from "../../lib/invoiceLine";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { reserveZatcaChain, rebuildZatcaDocumentXml, ZatcaCompanyLike, ZatcaPersistedLineLike } from "../../lib/zatca/chain";
import { submitZatcaChainDocument } from "../../lib/zatca/postingGate";
import { newQueryCounter, counted, logPostingPhaseTiming } from "../../lib/zatca/postingInstrumentation";

/** انظر التعليق المطابق في salesReturns.service.ts — نفس المنطق لإشعار مدين، بما في ذلك اشتراط
 * أن تكون الفاتورة المرتبطة "posted" فعلياً (لا مسودة، ولا pending_submission/
 * zatca_accepted_posting_incomplete). */
async function resolveBillingReferenceNumber(tenantId: string, relatedInvoiceId: string | null | undefined): Promise<string | undefined> {
  if (!relatedInvoiceId) return undefined;
  const relatedInvoice = await prisma.salesInvoice.findFirst({ where: { id: relatedInvoiceId, tenantId }, select: { invoiceNumber: true, status: true } });
  if (!relatedInvoice) return undefined;
  if (relatedInvoice.status !== "posted") {
    throw badRequest("لا يمكن إصدار إشعار مدين لفاتورة لم تُرحَّل بعد — الفاتورة الأصلية إما مسودة أو لا تزال قيد معالجة زاتكا (في انتظار الإرسال أو لم يكتمل ترحيلها المحلي بعد)");
  }
  return relatedInvoice.invoiceNumber;
}

interface LineInput {
  accountId: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
}

interface DebitNoteInput {
  companyId: string;
  customerId: string;
  relatedInvoiceId?: string;
  date: Date;
  reason?: string;
  chargeMethod: "account" | "cash" | "bank";
  lines: LineInput[];
}

const debitNoteInclude = { lines: { include: { account: true } }, customer: true, company: true } as const;

type SalesDebitNoteWithZatcaChain = Prisma.SalesDebitNoteGetPayload<{ include: typeof debitNoteInclude }>;

/** شكل إعادة موحَّد — راجع InvoicePostingOutcome في salesInvoices.service.ts لنفس السبب بالضبط:
 * حقول الإشعار المدين دائماً موجودة، والحقول الإضافية اختيارية بحسب ما حدث تحديداً. */
type SalesDebitNotePostingOutcome = SalesDebitNoteWithZatcaChain & {
  rejectionReason?: string;
  postingIncomplete?: boolean;
};

// إشعار مدين = عكس منطق المردود تماماً: يزيد ما يستحق على العميل بدل تخفيضه، لذا نفس أسماء
// الحسابات المرجعية (النقدية/البنك/الذمم) لكن الأثر المحاسبي معكوس (انظر buildDebitNoteJournalLines أدناه).
const CHARGE_ACCOUNT_NAME: Record<string, string> = {
  cash: "النقدية بالصندوق",
  bank: "البنك الأهلي - حساب تشغيلي",
  account: "ذمم مدينة",
};

export async function listSalesDebitNotes(tenantId: string, filters: { companyId?: string; customerId?: string }) {
  return prisma.salesDebitNote.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, customerId: filters.customerId || undefined },
    include: debitNoteInclude,
    orderBy: { createdAt: "desc" },
  });
}

function buildDebitNoteJournalLines(
  computed: Array<{ accountId: string; subtotal: number }>,
  customerId: string,
  vatOutputId: string,
  vatTotal: number,
  chargeAccountId: string,
  grandTotal: number,
) {
  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));
  return [
    { accountId: chargeAccountId, department: "المالية والحسابات", debit: grandTotal, credit: 0, customerId },
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: 0, credit: amount, customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: 0, credit: vatTotal, customerId },
  ];
}

async function resolveChargeAccountId(tenantId: string, companyId: string, customer: { id: string; accountId: string | null; name: string }, chargeMethod: string) {
  return chargeMethod === "account"
    ? resolvePartyAccountId(tenantId, companyId, customer, CHARGE_ACCOUNT_NAME.account)
    : getAccountIdByName(tenantId, companyId, CHARGE_ACCOUNT_NAME[chargeMethod] ?? CHARGE_ACCOUNT_NAME.account);
}

export async function createSalesDebitNote(tenantId: string, userId: string, input: DebitNoteInput): Promise<SalesDebitNotePostingOutcome> {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: input.companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId: input.companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");

  const computed = input.lines.map((l) => ({ ...l, ...computeInvoiceLine(l), taxCategoryCode: "S" as const, taxExemptionReason: null as string | null }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  if (grandTotal <= 0) throw badRequest("إجمالي الإشعار المدين يجب أن يكون أكبر من صفر");

  const zatcaUuid = randomUUID();
  const billingReferenceId = await resolveBillingReferenceNumber(tenantId, input.relatedInvoiceId);
  // BR-KSA-17: إلزامي لإشعار المدين كلما ارتبط بفاتورة أصلية فعلياً (عندئذٍ فقط يُرسَل لزاتكا) —
  // إشعار بلا فاتورة أصلية مرتبطة يبقى مستنداً محاسبياً داخلياً بحتاً (zatcaStatus=not_applicable)،
  // فلا يحتاج سبباً إلزامياً لزاتكا لأنه لن يصلها إطلاقاً. راجع نفس المنطق بالضبط في salesReturns.service.ts.
  const issuanceReason = input.reason?.trim();
  if (billingReferenceId && !issuanceReason) {
    throw badRequest("سبب إصدار إشعار المدين (BR-KSA-17) إلزامي عند ربطه بفاتورة أصلية سترسَل لزاتكا");
  }

  const vatOutputId = await getAccountIdByName(tenantId, input.companyId, "ضريبة القيمة المضافة - مخرجات");
  const chargeAccountId = await resolveChargeAccountId(tenantId, input.companyId, customer, input.chargeMethod);
  const journalLines = buildDebitNoteJournalLines(computed, input.customerId, vatOutputId, vatTotal, chargeAccountId, grandTotal);
  const zatcaLines: ZatcaPersistedLineLike[] = computed.map((l) => ({ ...l, description: l.description ?? null }));

  // المرحلة 1 — معاملة قصيرة واحدة: تحجز رقم الإشعار وسلسلة ICV/PIH (إن انطبقت زاتكا) وتكتب
  // الصف وسطوره فوراً، بلا أي اتصال شبكي بزاتكا هنا إطلاقاً.
  const counter1 = newQueryCounter();
  const startedAt1 = Date.now();
  let phase1Outcome: "committed" | "failed" = "failed";
  let phase1: { kind: "done"; debitNote: SalesDebitNoteWithZatcaChain } | { kind: "pending"; debitNote: SalesDebitNoteWithZatcaChain; xml: string; subtype: "standard" | "simplified" };
  try {
    phase1 = await prisma.$transaction(async (tx) => {
      const debitNoteNumber = await counted(counter1, reserveDocumentNumber(tx, tenantId, input.companyId, "sales_debit_note"));
      const chain = billingReferenceId
        ? await counted(
            counter1,
            reserveZatcaChain(tx, {
              company, customer, kind: "debit_note", documentNumber: debitNoteNumber, documentUuid: zatcaUuid,
              billingReferenceId, issuanceReason, lines: zatcaLines,
            }),
          )
        : null;
      const baseData = {
        tenantId, debitNoteNumber, companyId: input.companyId, customerId: input.customerId,
        relatedInvoiceId: input.relatedInvoiceId, reason: input.reason, chargeMethod: input.chargeMethod, date: input.date,
        zatcaUuid, subtotal, vatTotal, grandTotal, lines: { create: computed },
      };
      if (!chain) {
        const entry = await counted(counter1, createJournalEntryTx(tx, {
          tenantId, companyId: input.companyId, date: input.date, memo: `إشعار مدين ${debitNoteNumber} — ${customer.name}`,
          sourceModule: "sales_debit_note", createdBy: userId, lines: journalLines,
        }));
        const debitNote = await counted(counter1, tx.salesDebitNote.create({
          data: { ...baseData, status: "posted", journalEntryId: entry.id, zatcaStatus: "not_applicable" },
          include: debitNoteInclude,
        }));
        await counted(counter1, tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: debitNote.id } }));
        return { kind: "done" as const, debitNote };
      }
      const debitNote = await counted(counter1, tx.salesDebitNote.create({
        data: {
          ...baseData, status: "pending_submission", icv: chain.icv, previousInvoiceHash: chain.previousInvoiceHash,
          invoiceHash: chain.invoiceHash, zatcaStatus: "not_submitted", zatcaSubmittedAt: chain.issuedAt,
        },
        include: debitNoteInclude,
      }));
      return { kind: "pending" as const, debitNote, xml: chain.xml, subtype: chain.subtype };
    }, { timeout: 8000 });
    phase1Outcome = "committed";
  } finally {
    logPostingPhaseTiming({ phase: "1", kind: "debit_note", startedAt: startedAt1, counter: counter1, outcome: phase1Outcome });
  }

  if (phase1.kind === "done") return phase1.debitNote;
  return finishDebitNoteZatcaSubmission(tenantId, userId, {
    debitNote: phase1.debitNote, xml: phase1.xml, subtype: phase1.subtype, company, grandTotal, vatTotal, journalLines,
  });
}

/** المراحل 2 (لا معاملة) + 3أ (تحديث سطر واحد) + 3ب (معاملة منفصلة: القيد فقط، لا مخزون ولا
 * عمولات لإشعارات المدين) — مُشتركة بين createSalesDebitNote/postSalesDebitNote/retryPendingZatcaSubmission. */
async function finishDebitNoteZatcaSubmission(
  tenantId: string,
  userId: string,
  params: {
    debitNote: SalesDebitNoteWithZatcaChain;
    xml: string;
    subtype: "standard" | "simplified";
    company: ZatcaCompanyLike;
    grandTotal: number;
    vatTotal: number;
    journalLines: ReturnType<typeof buildDebitNoteJournalLines>;
  },
): Promise<SalesDebitNotePostingOutcome> {
  const { debitNote, xml, subtype, company, grandTotal, vatTotal, journalLines } = params;

  const decision = await submitZatcaChainDocument({
    company,
    documentNumber: debitNote.debitNoteNumber,
    documentUuid: debitNote.zatcaUuid,
    kind: "debit_note",
    chain: {
      xml, subtype, icv: debitNote.icv!, previousInvoiceHash: debitNote.previousInvoiceHash!,
      invoiceHash: debitNote.invoiceHash!, issuedAt: debitNote.zatcaSubmittedAt!,
    },
    grandTotal, vatTotal,
  });

  const afterResponse = await prisma.salesDebitNote.update({
    where: { id: debitNote.id },
    data: {
      zatcaStatus: decision.zatcaFields.zatcaStatus,
      zatcaResponseRaw: (decision.zatcaFields.zatcaResponseRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      zatcaClearedOrReportedAt: decision.zatcaFields.zatcaClearedOrReportedAt,
      status: decision.proceedWithPosting ? "zatca_accepted_posting_incomplete" : "pending_submission",
    },
    include: debitNoteInclude,
  });

  if (!decision.proceedWithPosting) {
    return { ...afterResponse, rejectionReason: decision.rejectionReason };
  }

  try {
    return await completeDebitNoteLocalPosting(tenantId, userId, afterResponse, journalLines);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[zatca-posting-instrumentation] phase=3b kind=debit_note outcome=failed documentUuid=${debitNote.zatcaUuid} debitNoteNumber=${debitNote.debitNoteNumber} — سيُكتمَل لاحقاً عبر completeZatcaAcceptedPosting:`,
      err,
    );
    return { ...afterResponse, postingIncomplete: true };
  }
}

async function completeDebitNoteLocalPosting(
  tenantId: string,
  userId: string,
  debitNote: SalesDebitNoteWithZatcaChain,
  journalLines: ReturnType<typeof buildDebitNoteJournalLines>,
): Promise<SalesDebitNotePostingOutcome> {
  const counter = newQueryCounter();
  const startedAt = Date.now();
  let outcome: "committed" | "failed" = "failed";
  try {
    const posted = await prisma.$transaction(async (tx) => {
      const entry = await counted(counter, createJournalEntryTx(tx, {
        tenantId, companyId: debitNote.companyId, date: debitNote.date,
        memo: `إشعار مدين ${debitNote.debitNoteNumber} — ${debitNote.customer.name}`,
        sourceModule: "sales_debit_note", sourceId: debitNote.id, createdBy: userId, lines: journalLines,
      }));
      return counted(counter, tx.salesDebitNote.update({
        where: { id: debitNote.id }, data: { status: "posted", journalEntryId: entry.id }, include: debitNoteInclude,
      }));
    }, { timeout: 8000 });
    outcome = "committed";
    return posted;
  } finally {
    logPostingPhaseTiming({ phase: "3b", kind: "debit_note", startedAt, counter, outcome });
  }
}

function toComputedDebitNoteLines(lines: SalesDebitNoteWithZatcaChain["lines"]) {
  return lines.map((l) => ({
    accountId: l.accountId,
    subtotal: Number(l.subtotal),
    vat: Number(l.vat),
    total: Number(l.total),
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
  }));
}

function toZatcaDebitNoteLines(lines: SalesDebitNoteWithZatcaChain["lines"]): ZatcaPersistedLineLike[] {
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

export async function deleteSalesDebitNote(tenantId: string, id: string) {
  const existing = await prisma.salesDebitNote.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الإشعار المدين غير موجود");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف إشعار مدين مرحّل، يجب فك ترحيله أولاً");
  await prisma.salesDebitNote.delete({ where: { id } });
}

export async function postSalesDebitNote(tenantId: string, userId: string, id: string): Promise<SalesDebitNotePostingOutcome> {
  const debitNote = await prisma.salesDebitNote.findFirst({ where: { id, tenantId }, include: debitNoteInclude });
  if (!debitNote) throw notFound("الإشعار المدين غير موجود");
  if (debitNote.status === "posted") throw badRequest("الإشعار المدين مرحّل بالفعل");
  if (debitNote.status !== "draft") {
    throw badRequest("هذا الإشعار قيد معالجة زاتكا بالفعل — استخدم إعادة المحاولة أو إكمال الترحيل بدلاً من الترحيل من جديد");
  }
  const company = await prisma.company.findFirstOrThrow({ where: { id: debitNote.companyId, tenantId } });
  const customer = debitNote.customer;

  const computed = toComputedDebitNoteLines(debitNote.lines);
  const vatOutputId = await getAccountIdByName(tenantId, debitNote.companyId, "ضريبة القيمة المضافة - مخرجات");
  const chargeAccountId = await resolveChargeAccountId(tenantId, debitNote.companyId, customer, debitNote.chargeMethod || "account");
  const journalLines = buildDebitNoteJournalLines(computed, debitNote.customerId, vatOutputId, Number(debitNote.vatTotal), chargeAccountId, Number(debitNote.grandTotal));
  const billingReferenceId = await resolveBillingReferenceNumber(tenantId, debitNote.relatedInvoiceId);
  const zatcaUuid = debitNote.zatcaUuid;

  const counter1 = newQueryCounter();
  const startedAt1 = Date.now();
  let phase1Outcome: "committed" | "failed" = "failed";
  let phase1: { kind: "done"; debitNote: SalesDebitNoteWithZatcaChain } | { kind: "pending"; debitNote: SalesDebitNoteWithZatcaChain; xml: string; subtype: "standard" | "simplified" };
  try {
    phase1 = await prisma.$transaction(async (tx) => {
      const chain = billingReferenceId
        ? await counted(
            counter1,
            reserveZatcaChain(tx, {
              company, customer, kind: "debit_note", documentNumber: debitNote.debitNoteNumber, documentUuid: zatcaUuid,
              billingReferenceId, issuanceReason: debitNote.reason?.trim() || undefined, lines: toZatcaDebitNoteLines(debitNote.lines),
            }),
          )
        : null;
      if (!chain) {
        const entry = await counted(counter1, createJournalEntryTx(tx, {
          tenantId, companyId: debitNote.companyId, date: debitNote.date, memo: `إشعار مدين ${debitNote.debitNoteNumber} — ${customer.name}`,
          sourceModule: "sales_debit_note", sourceId: debitNote.id, createdBy: userId, lines: journalLines,
        }));
        const updated = await counted(counter1, tx.salesDebitNote.update({
          where: { id }, data: { status: "posted", journalEntryId: entry.id, zatcaStatus: "not_applicable" }, include: debitNoteInclude,
        }));
        return { kind: "done" as const, debitNote: updated };
      }
      const updated = await counted(counter1, tx.salesDebitNote.update({
        where: { id },
        data: {
          status: "pending_submission", icv: chain.icv, previousInvoiceHash: chain.previousInvoiceHash,
          invoiceHash: chain.invoiceHash, zatcaStatus: "not_submitted", zatcaSubmittedAt: chain.issuedAt,
        },
        include: debitNoteInclude,
      }));
      return { kind: "pending" as const, debitNote: updated, xml: chain.xml, subtype: chain.subtype };
    }, { timeout: 8000 });
    phase1Outcome = "committed";
  } finally {
    logPostingPhaseTiming({ phase: "1", kind: "debit_note", startedAt: startedAt1, counter: counter1, outcome: phase1Outcome });
  }

  if (phase1.kind === "done") return phase1.debitNote;
  return finishDebitNoteZatcaSubmission(tenantId, userId, {
    debitNote: phase1.debitNote, xml: phase1.xml, subtype: phase1.subtype, company,
    grandTotal: Number(debitNote.grandTotal), vatTotal: Number(debitNote.vatTotal), journalLines,
  });
}

/** إعادة محاولة إرسال إشعار مدين عالق بحالة pending_submission — بنفس UUID/ICV/التجزئة المخزَّنة
 * على الصف بالضبط، بلا حجز أي شيء جديد إطلاقاً. راجع retryPendingZatcaSubmission في
 * salesInvoices.service.ts/salesReturns.service.ts لنفس التصميم بالضبط. */
export async function retryPendingZatcaSubmission(tenantId: string, userId: string, id: string): Promise<SalesDebitNotePostingOutcome> {
  const debitNote = await prisma.salesDebitNote.findFirst({ where: { id, tenantId }, include: debitNoteInclude });
  if (!debitNote) throw notFound("الإشعار المدين غير موجود");
  if (debitNote.status !== "pending_submission") {
    throw badRequest("إعادة المحاولة متاحة فقط لإشعار مدين في انتظار الإرسال لزاتكا");
  }
  if (debitNote.icv == null || !debitNote.previousInvoiceHash || !debitNote.invoiceHash || !debitNote.zatcaSubmittedAt) {
    throw badRequest("بيانات سلسلة زاتكا لهذا الإشعار غير مكتملة — تعذّرت إعادة المحاولة، راجع الدعم الفني");
  }

  const company = await prisma.company.findFirstOrThrow({ where: { id: debitNote.companyId, tenantId } });
  const billingReferenceId = await resolveBillingReferenceNumber(tenantId, debitNote.relatedInvoiceId);
  if (!billingReferenceId) {
    throw badRequest("تعذّرت إعادة المحاولة: الفاتورة الأصلية المرتبطة بهذا الإشعار لم تعد موجودة — راجع الدعم الفني");
  }

  const rebuilt = rebuildZatcaDocumentXml({
    company, customer: debitNote.customer, kind: "debit_note", documentNumber: debitNote.debitNoteNumber,
    documentUuid: debitNote.zatcaUuid, lines: toZatcaDebitNoteLines(debitNote.lines),
    icv: debitNote.icv, previousInvoiceHash: debitNote.previousInvoiceHash, issuedAt: debitNote.zatcaSubmittedAt,
    billingReferenceId, issuanceReason: debitNote.reason?.trim() || undefined,
  });
  if (rebuilt.invoiceHash !== debitNote.invoiceHash) {
    throw badRequest("تعذّرت إعادة المحاولة: بيانات الإشعار المخزَّنة لا تطابق ما حُجزت له السلسلة أصلاً — راجع الدعم الفني قبل أي محاولة أخرى");
  }

  const computed = toComputedDebitNoteLines(debitNote.lines);
  const vatOutputId = await getAccountIdByName(tenantId, debitNote.companyId, "ضريبة القيمة المضافة - مخرجات");
  const chargeAccountId = await resolveChargeAccountId(tenantId, debitNote.companyId, debitNote.customer, debitNote.chargeMethod || "account");
  const journalLines = buildDebitNoteJournalLines(computed, debitNote.customerId, vatOutputId, Number(debitNote.vatTotal), chargeAccountId, Number(debitNote.grandTotal));

  return finishDebitNoteZatcaSubmission(tenantId, userId, {
    debitNote, xml: rebuilt.xml, subtype: rebuilt.subtype, company,
    grandTotal: Number(debitNote.grandTotal), vatTotal: Number(debitNote.vatTotal), journalLines,
  });
}

/** تُكمل الترحيل المحلي (القيد فقط) لإشعار مدين استلم ردّاً من زاتكا بالفعل لكن المرحلة 3ب السابقة
 * فشلت — بلا أي اتصال جديد بزاتكا إطلاقاً. */
export async function completeZatcaAcceptedPosting(tenantId: string, userId: string, id: string): Promise<SalesDebitNotePostingOutcome> {
  const debitNote = await prisma.salesDebitNote.findFirst({ where: { id, tenantId }, include: debitNoteInclude });
  if (!debitNote) throw notFound("الإشعار المدين غير موجود");
  if (debitNote.status !== "zatca_accepted_posting_incomplete") {
    throw badRequest("إكمال الترحيل متاح فقط لإشعار مدين استلم ردّاً من زاتكا لكن لم يكتمل ترحيله المحلي بعد");
  }
  const computed = toComputedDebitNoteLines(debitNote.lines);
  const vatOutputId = await getAccountIdByName(tenantId, debitNote.companyId, "ضريبة القيمة المضافة - مخرجات");
  const chargeAccountId = await resolveChargeAccountId(tenantId, debitNote.companyId, debitNote.customer, debitNote.chargeMethod || "account");
  const journalLines = buildDebitNoteJournalLines(computed, debitNote.customerId, vatOutputId, Number(debitNote.vatTotal), chargeAccountId, Number(debitNote.grandTotal));
  return completeDebitNoteLocalPosting(tenantId, userId, debitNote, journalLines);
}

export async function unpostSalesDebitNote(tenantId: string, userId: string, id: string, pin: string) {
  const debitNote = await prisma.salesDebitNote.findFirst({ where: { id, tenantId } });
  if (!debitNote) throw notFound("الإشعار المدين غير موجود");
  if (debitNote.status !== "posted") throw badRequest("الإشعار المدين ليس مرحّلاً أصلاً");
  if (debitNote.zatcaStatus !== "not_applicable") {
    throw badRequest("لا يمكن فك ترحيل إشعار مدين مرتبط بسلسلة تجزئة زاتكا (ICV/PIH) — هذا يكسر السلسلة بشكل غير قابل للإصلاح");
  }

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, debitNote.journalEntryId);
    const updated = await tx.salesDebitNote.update({
      where: { id },
      data: { status: "draft", journalEntryId: null },
      include: debitNoteInclude,
    });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "SalesDebitNote", entityId: id });
    return updated;
  });
}
