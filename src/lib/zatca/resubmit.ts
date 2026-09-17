import { badRequest } from "../httpError";
import { buildQrBaseParams, rebuildZatcaDocumentXml, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "./chain";
import { loadCompanyZatcaCredentials } from "./credentials";
import { resolveZatcaSubmissionKind, signAndSubmitDocument } from "./submission";
import { ZatcaApiEnvironment } from "./apiClient";
import { ZatcaDocumentStatus } from "@prisma/client";

export interface ResubmitZatcaDocumentParams {
  company: ZatcaCompanyLike;
  customer: ZatcaCustomerLike;
  documentNumber: string;
  documentUuid: string;
  lines: ZatcaPersistedLineLike[];
  grandTotal: number;
  vatTotal: number;
  icv: number;
  previousInvoiceHash: string;
  /** invoiceHash المخزَّن من محاولة الترحيل الأصلية — يُتحقَّق من مطابقته قبل إعادة الإرسال */
  invoiceHash: string;
  issuedAt: Date;
}

export interface ResubmitZatcaDocumentResult {
  zatcaStatus: Extract<
    ZatcaDocumentStatus,
    "cleared" | "reported" | "rejected" | "submission_failed" | "certificate_error" | "compliance_checked"
  >;
  zatcaResponseRaw?: unknown;
  zatcaClearedOrReportedAt?: Date;
  rejectionReason?: string;
}

/**
 * يعيد محاولة إرسال مستند رفضته زاتكا سابقاً أو تعذّر الوصول إليها عند الترحيل، بنفس محتواه
 * بالضبط — بلا حجز رقم ICV جديد ولا أي تعديل على بيانات الفاتورة نفسها. يُستخدَم فقط من زر "إعادة
 * إرسال" على فاتورة مُرحَّلة فعلاً بحالة zatcaStatus = "rejected" أو "submission_failed"
 * (المُرحِّل هو المسؤول عن هذا التحقق قبل الاستدعاء).
 */
export async function resubmitZatcaDocument(params: ResubmitZatcaDocumentParams): Promise<ResubmitZatcaDocumentResult> {
  const rebuilt = rebuildZatcaDocumentXml({
    company: params.company,
    customer: params.customer,
    kind: "invoice",
    documentNumber: params.documentNumber,
    documentUuid: params.documentUuid,
    lines: params.lines,
    icv: params.icv,
    previousInvoiceHash: params.previousInvoiceHash,
    issuedAt: params.issuedAt,
  });

  if (rebuilt.invoiceHash !== params.invoiceHash) {
    throw badRequest("تعذّرت إعادة الإرسال: بيانات المستند لا تطابق النسخة الأصلية المُرحَّلة — راجع الدعم الفني قبل المحاولة مجدداً");
  }

  const credentials = await loadCompanyZatcaCredentials(params.company.id, params.company.zatcaEnvironment as ZatcaApiEnvironment);
  if (!credentials) {
    throw badRequest("لا توجد شهادة ربط زاتكا فعالة لهذه الشركة حالياً — أكمل خطوات الربط من شاشة \"ربط فاتورة\" أولاً");
  }

  const outcome = await signAndSubmitDocument({
    xml: rebuilt.xml,
    uuid: params.documentUuid,
    environment: params.company.zatcaEnvironment as ZatcaApiEnvironment,
    credentials,
    kind: resolveZatcaSubmissionKind(params.company.zatcaOnboardingStatus, rebuilt.subtype),
    qrBaseParams: buildQrBaseParams(params.company, params.issuedAt, params.grandTotal, params.vatTotal),
  });

  if (outcome.accepted) {
    // راجع نفس التمييز في postingGate.ts: نجاح فحص امتثال (شهادة اختبار) لا يُعتبَر تخليصاً/إبلاغاً
    // فعلياً — يُصنَّف compliance_checked بلا zatcaClearedOrReportedAt (لم يحدث تخليص/إبلاغ قانوني).
    const isProductionSubmission = params.company.zatcaOnboardingStatus === "production";
    if (!isProductionSubmission) {
      return { zatcaStatus: "compliance_checked", zatcaResponseRaw: outcome.response ?? undefined };
    }
    return {
      zatcaStatus: rebuilt.subtype === "standard" ? "cleared" : "reported",
      zatcaResponseRaw: outcome.response ?? undefined,
      zatcaClearedOrReportedAt: new Date(),
    };
  }
  if (!outcome.certificateError && !outcome.networkError && !outcome.httpError) {
    // نفس تسجيل الرفض الصريح في postingGate.ts أعلاه، لمسار إعادة الإرسال (يدوية أو تلقائية) —
    // كان صامتاً تماماً بلا أي سطر سجلّ حتى الآن أيضاً. httpError مُستبعَدة هنا لنفس السبب: سُجِّلت
    // بالفعل بصورتها الكاملة (status/statusText/الترويسات/الجسم الخام) داخل zatcaRequest نفسها.
    // eslint-disable-next-line no-console
    console.error(
      `[resubmitZatcaDocument] رفضت زاتكا مستنداً عند إعادة الإرسال — الشركة "${params.company.name}" (${params.company.id})، رقم المستند=${params.documentNumber}، ` +
        `documentUuid=${params.documentUuid}، السبب المعروض للمستخدم=${outcome.reason} — الاستجابة الخام الكاملة من زاتكا: ${JSON.stringify(outcome.response)}`,
    );
  }
  return {
    // راجع نفس التمييز في postingGate.ts: httpError (فشل نقل/مصادقة، لا تقييم فعلي للمستند) تُصنَّف
    // submission_failed بنفس معاملة عطل الشبكة، لا rejected.
    zatcaStatus: outcome.certificateError ? "certificate_error" : outcome.networkError || outcome.httpError ? "submission_failed" : "rejected",
    zatcaResponseRaw: outcome.response ?? undefined,
    rejectionReason: outcome.reason,
  };
}
