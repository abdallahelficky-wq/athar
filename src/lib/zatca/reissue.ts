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
export function assertReissuable(
  doc: { status: string; zatcaStatus: string; icv: number | null; invoiceHash: string | null },
  customer: ZatcaCustomerLike,
): void {
  if (doc.status !== "pending_submission" || doc.zatcaStatus !== "rejected" || doc.icv == null || !doc.invoiceHash) {
    throw badRequest("إعادة الإصدار متاحة فقط لمستند قياسي رفضته زاتكا ولم يُرحَّل بعد — لتعذّر الإرسال استخدم إعادة المحاولة");
  }
  if (subtypeForCustomer(customer) !== "standard") {
    throw badRequest("إعادة الإصدار متاحة فقط لمستند قياسي (عميل أعمال برقم ضريبي) — عميل هذا المستند لم يعد كذلك");
  }
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
    billingReferenceId: params.billingReferenceId, issuanceReason: params.issuanceReason, lines: params.lines, supplyDate,
  });
  if (!chain) throw badRequest("الشركة غير مرتبطة بزاتكا — لا معنى لإعادة الإصدار");
  return { chain, documentUuid, supplyDate };
}

export const REISSUE_CONFLICT_MESSAGE = "تعذّرت إعادة الإصدار: حالة المستند تغيّرت (أُعيد إصداره أو إرساله للتو) — حدّث الصفحة وتحقّق من حالته";
