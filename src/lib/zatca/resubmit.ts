import { badRequest } from "../httpError";
import { buildQrBaseParams, rebuildZatcaDocumentXml, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "./chain";
import { loadCompanyZatcaCredentials } from "./credentials";
import { signAndSubmitDocument } from "./submission";
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
  zatcaStatus: Extract<ZatcaDocumentStatus, "cleared" | "reported" | "rejected">;
  zatcaResponseRaw?: unknown;
  zatcaClearedOrReportedAt?: Date;
  rejectionReason?: string;
}

/**
 * يعيد محاولة إرسال مستند رفضته زاتكا سابقاً بنفس محتواه بالضبط — بلا حجز رقم ICV جديد ولا أي
 * تعديل على بيانات الفاتورة نفسها. يُستخدَم فقط من زر "إعادة إرسال" على فاتورة مُرحَّلة فعلاً
 * بحالة zatcaStatus = "rejected" (المُرحِّل هو المسؤول عن هذا التحقق قبل الاستدعاء).
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
    kind: rebuilt.subtype === "standard" ? "clearance" : "reporting",
    qrBaseParams: buildQrBaseParams(params.company, params.issuedAt, params.grandTotal, params.vatTotal),
  });

  if (outcome.accepted) {
    return {
      zatcaStatus: rebuilt.subtype === "standard" ? "cleared" : "reported",
      zatcaResponseRaw: outcome.response ?? undefined,
      zatcaClearedOrReportedAt: new Date(),
    };
  }
  return { zatcaStatus: "rejected", zatcaResponseRaw: outcome.response ?? undefined, rejectionReason: outcome.reason };
}
