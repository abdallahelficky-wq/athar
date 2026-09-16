import { signDocument } from "./signing";
import { buildSignedQrPayload, ZatcaQrUnsignedParams } from "./qr";
import { clearInvoice, extractRejectionReasons, reportInvoice, ZatcaApiEnvironment, ZatcaSubmissionResponse } from "./apiClient";
import { ResolvedZatcaCredentials } from "./credentials";

// يجمع بين التوقيع (المرحلة C) والإرسال الفعلي (عميل API أعلاه) في خطوة واحدة — هذا ما يستدعيه
// كل من salesInvoices/salesReturns/salesDebitNotes عند الترحيل فعلياً، بدل أن يكرّر كل موديول نفس
// التسلسل (توقيع → بناء QR → إرسال → تفسير الرد).

export type ZatcaSubmissionKind = "clearance" | "reporting";

export interface SubmitDocumentParams {
  /** XML غير موقّع من buildDocumentXml */
  xml: string;
  uuid: string;
  environment: ZatcaApiEnvironment;
  credentials: ResolvedZatcaCredentials;
  kind: ZatcaSubmissionKind;
  qrBaseParams: ZatcaQrUnsignedParams;
}

export interface ZatcaSubmissionAccepted {
  accepted: true;
  response: ZatcaSubmissionResponse | null;
  signedXml: string;
  invoiceHash: string;
  qrPayload: string;
}

export interface ZatcaSubmissionRejected {
  accepted: false;
  response: ZatcaSubmissionResponse | null;
  reason: string;
  signedXml: string;
  invoiceHash: string;
  /** true إن كان الرفض بسبب تعذّر الاتصال بزاتكا نفسه (لم يُرسَل شيء أصلاً) لا رد رفض فعلي منها */
  networkError?: boolean;
  /** true إن فشل التوقيع محلياً (شهادة/مفتاح زاتكا غير صالح لهذه الشركة) قبل أي محاولة اتصال
   * بزاتكا إطلاقاً — راجع signAndSubmitDocument أدناه لتفاصيل الفرق عن networkError. */
  certificateError?: boolean;
}

export type ZatcaSubmissionOutcome = ZatcaSubmissionAccepted | ZatcaSubmissionRejected;

export async function signAndSubmitDocument(params: SubmitDocumentParams): Promise<ZatcaSubmissionOutcome> {
  let signed: ReturnType<typeof signDocument>;
  try {
    signed = signDocument({
      xml: params.xml,
      certificatePem: params.credentials.certificateBodyBase64,
      privateKeyPem: params.credentials.privateKeyPem,
    });
  } catch (err) {
    // خطأ تشفيري خام (OpenSSL، مثل "asn1 encoding routines::wrong tag") عند محاولة تحليل شهادة أو
    // مفتاح زاتكا المخزَّنين لهذه الشركة — سببه شبه مؤكَّد شهادة/مفتاح بصيغة غير صالحة (راجع
    // scripts/check-zatca-certificate.ts لتشخيص دقيق بلا كشف أي سرّ)، لا عطل في منطق التوقيع نفسه،
    // ولا علاقة له بزاتكا أو بالشبكة إطلاقاً — لم يصل الطلب لزاتكا أصلاً. يُسجَّل هنا فقط (لا يُرفَع
    // كاستثناء خام يُسقِط الطلب بخطأ 500 عام لا يفسّر شيئاً للمستخدم)، ويُصنَّف certificateError
    // (لا networkError) تحديداً لاستبعاده من إعادة المحاولة التلقائية — راجع postingGate.ts
    // وZATCA_AUTO_RETRY_STATUSES في salesInvoices.service.ts.
    // eslint-disable-next-line no-console
    console.error(
      `[signAndSubmitDocument] فشل توقيع مستند زاتكا محلياً — شهادة/مفتاح غير صالح لهذه الشركة. الخطأ الفعلي: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      accepted: false,
      response: null,
      reason:
        "تعذّر توقيع الفاتورة إلكترونياً — شهادة الربط مع هيئة الزكاة والضريبة والجمارك (زاتكا) المسجَّلة لهذه الشركة غير صالحة أو تالفة. راجع إعدادات ربط زاتكا لهذه الشركة (قد تحتاج إعادة استخراج الشهادة)، أو تواصل مع الدعم الفني إن استمرت المشكلة.",
      signedXml: "",
      invoiceHash: "",
      certificateError: true,
    };
  }
  const { signedXml, invoiceHash, digitalSignature, certificateInfo } = signed;

  const qrPayload = buildSignedQrPayload({
    ...params.qrBaseParams,
    invoiceHashBase64: invoiceHash,
    digitalSignatureBase64: digitalSignature,
    publicKeyRaw: certificateInfo.publicKeyRaw,
    certificateSignatureRaw: certificateInfo.signatureRaw,
  });

  const signedInvoiceBase64 = Buffer.from(signedXml, "utf8").toString("base64");
  const submit = params.kind === "clearance" ? clearInvoice : reportInvoice;
  const result = await submit({
    environment: params.environment,
    credentials: params.credentials,
    signedInvoiceBase64,
    invoiceHash,
    uuid: params.uuid,
  });

  if (result.ok) {
    return { accepted: true, response: result.data, signedXml, invoiceHash, qrPayload };
  }
  const reason = result.networkError
    ? "تعذّر الاتصال بخادم هيئة الزكاة والضريبة والجمارك (زاتكا) — حاول لاحقاً أو راجع الدعم الفني"
    : result.malformedResponse
      ? "رد غير متوقع من زاتكا (نجاح HTTP لكن الشكل لا يطابق المتوقَّع) — لم تُعتمَد الاستجابة، حاول لاحقاً أو راجع الدعم الفني"
      : extractRejectionReasons(result.data);
  return { accepted: false, response: result.data, reason, signedXml, invoiceHash, networkError: result.networkError };
}
