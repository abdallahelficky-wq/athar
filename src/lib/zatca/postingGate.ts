import { Prisma } from "@prisma/client";
import { buildQrBaseParams, reserveZatcaChain, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "./chain";
import { loadCompanyZatcaCredentials } from "./credentials";
import { signAndSubmitDocument } from "./submission";
import { ZatcaApiEnvironment } from "./apiClient";
import { ZatcaDocumentKind } from "./types";

type Tx = Prisma.TransactionClient;

export type ZatcaPostingStatus = "not_applicable" | "pending_clearance" | "cleared" | "pending_reporting" | "reported" | "rejected";

export interface ZatcaPostingFields {
  icv?: number;
  previousInvoiceHash?: string;
  invoiceHash?: string;
  zatcaStatus: ZatcaPostingStatus;
  zatcaSubmittedAt?: Date;
  zatcaClearedOrReportedAt?: Date;
  zatcaResponseRaw?: Prisma.InputJsonValue;
}

export interface ZatcaPostingDecision {
  /** false فقط لفاتورة قياسية رفضتها زاتكا — يجب ألا تُرحَّل بأي حال (BR صريح من طلب المستخدم) */
  proceedWithPosting: boolean;
  zatcaFields: ZatcaPostingFields;
  rejectionReason?: string;
}

export interface EvaluateZatcaPostingGateParams {
  tx: Tx;
  company: ZatcaCompanyLike;
  customer: ZatcaCustomerLike;
  kind: ZatcaDocumentKind;
  documentNumber: string;
  documentUuid: string;
  billingReferenceId?: string;
  lines: ZatcaPersistedLineLike[];
  grandTotal: number;
  vatTotal: number;
}

/**
 * البوابة الوحيدة التي يستدعيها كل من salesInvoices/salesReturns/salesDebitNotes عند الترحيل
 * الفعلي — تقرّر: هل السلسلة (ICV/PIH) تُحجَز؟ هل تُرسَل الفاتورة فعلياً لزاتكا؟ وهل يُسمَح
 * بإكمال الترحيل (إنشاء القيد المحاسبي) أم يجب رفضه؟
 *
 * ثلاث حالات:
 * 1. الشركة غير مرتبطة بزاتكا بعد (not_onboarded) → لا حجز، لا إرسال، ترحيل عادي كما هو اليوم.
 * 2. مرتبطة لكن بلا شهادة CSID فعلية بعد (CompanyZatcaCredential غير مكتملة) → يُحجَز ICV/PIH
 *    فقط (سلسلة التجزئة تبدأ من الآن)، لكن بلا إرسال فعلي حتى تُستكمَل الشهادات لاحقاً.
 * 3. مرتبطة ولديها شهادة فعلية → توقيع + إرسال حقيقي؛ فاتورة قياسية مرفوضة تمنع الترحيل تماماً
 *    (لا تُعتبر نهائية حتى تُقبَل)، بينما فاتورة مبسّطة تُرحَّل دائماً (سُلِّمت للعميل فعلياً) وتُعاد
 *    محاولة الإبلاغ عنها لاحقاً إن رُفضت أول مرة.
 */
export async function evaluateZatcaPostingGate(params: EvaluateZatcaPostingGateParams): Promise<ZatcaPostingDecision> {
  const chain = await reserveZatcaChain(params.tx, {
    company: params.company,
    customer: params.customer,
    kind: params.kind,
    documentNumber: params.documentNumber,
    documentUuid: params.documentUuid,
    billingReferenceId: params.billingReferenceId,
    lines: params.lines,
  });

  if (!chain) {
    return { proceedWithPosting: true, zatcaFields: { zatcaStatus: "not_applicable" } };
  }

  const credentials = await loadCompanyZatcaCredentials(params.company.id, params.company.zatcaEnvironment as ZatcaApiEnvironment);
  if (!credentials) {
    return {
      proceedWithPosting: true,
      zatcaFields: {
        icv: chain.icv,
        previousInvoiceHash: chain.previousInvoiceHash,
        invoiceHash: chain.invoiceHash,
        zatcaStatus: chain.zatcaStatus,
        zatcaSubmittedAt: chain.issuedAt,
      },
    };
  }

  const outcome = await signAndSubmitDocument({
    xml: chain.xml,
    uuid: params.documentUuid,
    environment: params.company.zatcaEnvironment as ZatcaApiEnvironment,
    credentials,
    kind: chain.subtype === "standard" ? "clearance" : "reporting",
    qrBaseParams: buildQrBaseParams(params.company, chain.issuedAt, params.grandTotal, params.vatTotal),
  });

  if (outcome.accepted) {
    return {
      proceedWithPosting: true,
      zatcaFields: {
        icv: chain.icv,
        previousInvoiceHash: chain.previousInvoiceHash,
        invoiceHash: chain.invoiceHash,
        zatcaStatus: chain.subtype === "standard" ? "cleared" : "reported",
        zatcaSubmittedAt: chain.issuedAt,
        zatcaClearedOrReportedAt: new Date(),
        zatcaResponseRaw: (outcome.response ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    };
  }

  return {
    proceedWithPosting: chain.subtype !== "standard",
    zatcaFields: {
      icv: chain.icv,
      previousInvoiceHash: chain.previousInvoiceHash,
      invoiceHash: chain.invoiceHash,
      zatcaStatus: "rejected",
      zatcaSubmittedAt: chain.issuedAt,
      zatcaResponseRaw: (outcome.response ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    rejectionReason: outcome.reason,
  };
}
