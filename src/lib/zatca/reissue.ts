import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { badRequest } from "../httpError";
import { assertPeriodNotClosed, lockCompanyClosingDate } from "../fiscalClosing";
import { reserveZatcaChain, subtypeForCustomer, ZatcaChainResult, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "./chain";
import { ZatcaDocumentKind } from "./types";

type Tx = Prisma.TransactionClient;

/**
 * إعادة إصدار مستند قياسي (فاتورة 388، إشعار دائن 381، إشعار مدين 383) رفضته زاتكا في التخليص.
 *
 * الدليل الفني التفصيلي للفوترة الإلكترونية (E-Invoicing Detailed Technical Guideline) كما قرأه المالك:
 * - القسم 4.3.2: المستند القياسي لا يصبح صالحاً إلا بعد تخليصه — المرفوض ليس مستنداً صادراً، ولا يُصدَر عنه إشعار دائن.
 * - القسم 7: بعد تصحيح السبب يُرسَل مستند **آخر** بتجزئة وUUID وICV وطابع زمني جديدة؛ لا يُعاد استخدام UUID ولا ICV،
 *   ولا تتغيّر تجزئة المستند المرفوض ولا عدّاده (يبقيان في zatca_document_issues كما وُلِّدا).
 * - القسم 4.3: السلسلة تشمل المستندات المرفوضة؛ PIH للمستند الجديد = تجزئة آخر مستند وُلِّد في الشركة (أي company.zatcaLastInvoiceHash
 *   الحالي — قد يكون المرفوض نفسه أو مستنداً لاحقاً له).
 * - BT-1 (رقم المستند) غير محدَّد في الدليل لهذه الحالة — قرار المالك: يبقى الرقم نفسه.
 *
 * التواريخ (قرار المالك): تاريخ/وقت الإصدار (BT-2/BT-3) = لحظة إعادة الإصدار؛ تاريخ التوريد KSA-5 (BT-72 ActualDeliveryDate)
 * = تاريخ المستند الأصلي، ويبقى تاريخ القيد وفترة الضريبة على تاريخ المستند الأصلي. فترة مُقفلة ← رفض بلا حجز أي شيء.
 *
 * لا تعديل سطور في هذه المرحلة: المحتوى نفسه يُعاد بناؤه من الصف المخزَّن (التصحيح يكون في بطاقة العميل/الشركة).
 */
export type ReissueEligibility = { eligible: true; reason?: undefined } | { eligible: false; reason: string };

/**
 * شرط إعادة الإصدار — مصدر واحد للخادم (assertReissuable) وللواجهة (يُعاد مع سجل زاتكا، historyHandlers.ts):
 * - zatcaStatus = rejected (رفض فعلي من زاتكا؛ تعذّر الإرسال مساره إعادة المحاولة بنفس المعرّفات)؛
 * - الحالة pending_submission، أو posted للفاتورة وحدها: فاتورة قياسية رُحِّلت قبل تخليصها (not_submitted بلا شهادة ربط
 *   فعّالة — postingGate.ts، أو compliance_checked أثناء مرحلة الاختبار) ثم رُفضت عند إعادة إرسالها (resendInvoiceToZatca).
 *   تُعاد لها السلسلة ثم تُرسَل بلا قيد جديد (قيدها موجود). للإشعارين لا مسار إعادة إرسال بعد الترحيل، فلا تصل لتلك الحالة؛
 * - بيانات السلسلة مكتملة، والعميل الحالي قياسي (عميل أعمال برقم ضريبي).
 */
export function reissueEligibility(
  doc: { status: string; zatcaStatus: string; icv: number | null; invoiceHash: string | null },
  customer: ZatcaCustomerLike,
  opts: { postedAllowed: boolean },
): ReissueEligibility {
  if (doc.zatcaStatus !== "rejected") {
    return { eligible: false, reason: "إعادة الإصدار متاحة فقط لمستند رفضته زاتكا — لمستند تعذّر إرساله أو لم يُرسَل بعد استخدم إعادة الإرسال" };
  }
  const statusOk = doc.status === "pending_submission" || (opts.postedAllowed && doc.status === "posted");
  if (!statusOk) {
    return {
      eligible: false,
      reason: opts.postedAllowed
        ? "إعادة الإصدار متاحة فقط لفاتورة مرحّلة أو بانتظار الإرسال لزاتكا"
        : "إعادة الإصدار متاحة فقط لمستند قياسي رفضته زاتكا ولم يُرحَّل بعد — لتعذّر الإرسال استخدم إعادة المحاولة",
    };
  }
  if (doc.icv == null || !doc.invoiceHash) {
    return { eligible: false, reason: "بيانات سلسلة زاتكا لهذا المستند غير مكتملة — تعذّرت إعادة الإصدار، راجع الدعم الفني" };
  }
  if (subtypeForCustomer(customer) !== "standard") {
    return { eligible: false, reason: "إعادة الإصدار متاحة فقط لمستند قياسي (عميل أعمال برقم ضريبي) — عميل هذا المستند لم يعد كذلك" };
  }
  return { eligible: true };
}

export function assertReissuable(
  doc: { status: string; zatcaStatus: string; icv: number | null; invoiceHash: string | null },
  customer: ZatcaCustomerLike,
  opts: { postedAllowed: boolean } = { postedAllowed: false },
): void {
  const e = reissueEligibility(doc, customer, opts);
  if (!e.eligible) throw badRequest(e.reason);
}

export function supplyDateOf(documentDate: Date): string {
  return documentDate.toISOString().slice(0, 10);
}

/**
 * داخل معاملة إعادة الإصدار: يرفض الفترة المُقفلة (بقفل صف الشركة حتى نهاية المعاملة)، ثم يحجز ICV/PIH جديدين بـUUID جديد
 * وتاريخ توريد = تاريخ المستند. المستدعي يحدّث صف المستند بشرط أنه ما زال مرفوضاً بنفس UUID القديم (يمنع النقرة المزدوجة)
 * ثم يسجّل الإصدار الجديد مرتبطاً بالمرفوض (recordZatcaIssueTx).
 */
export async function reserveReissueChainTx(
  tx: Tx,
  params: {
    company: ZatcaCompanyLike;
    customer: ZatcaCustomerLike;
    kind: ZatcaDocumentKind;
    documentNumber: string;
    documentDate: Date;
    billingReferenceId?: string;
    issuanceReason?: string;
    lines: ZatcaPersistedLineLike[];
    actionLabel: string;
  },
): Promise<{ chain: ZatcaChainResult; documentUuid: string; supplyDate: string }> {
  const closingDate = await lockCompanyClosingDate(tx, params.company.id);
  assertPeriodNotClosed(closingDate, params.documentDate, params.actionLabel);
  const documentUuid = randomUUID();
  const supplyDate = supplyDateOf(params.documentDate);
  // الشركة تُقرأ من جديد داخل المعاملة بعد القفل: PIH = آخر تجزئة وُلِّدت فعلاً، لا ما قُرئ قبل بدء المعاملة
  const company = await tx.company.findUniqueOrThrow({ where: { id: params.company.id } });
  const chain = await reserveZatcaChain(tx, {
    company, customer: params.customer, kind: params.kind, documentNumber: params.documentNumber, documentUuid,
    billingReferenceId: params.billingReferenceId, issuanceReason: params.issuanceReason, lines: params.lines, documentDate: params.documentDate, supplyDate,
  });
  if (!chain) throw badRequest("الشركة غير مرتبطة بزاتكا — لا معنى لإعادة الإصدار");
  return { chain, documentUuid, supplyDate };
}

export const REISSUE_CONFLICT_MESSAGE = "تعذّرت إعادة الإصدار: حالة المستند تغيّرت (أُعيد إصداره أو إرساله للتو) — حدّث الصفحة وتحقّق من حالته";
