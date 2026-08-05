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
}

export type ZatcaSubmissionOutcome = ZatcaSubmissionAccepted | ZatcaSubmissionRejected;

export async function signAndSubmitDocument(params: SubmitDocumentParams): Promise<ZatcaSubmissionOutcome> {
  const { signedXml, invoiceHash, digitalSignature, certificateInfo } = signDocument({
    xml: params.xml,
    certificatePem: params.credentials.certificateBodyBase64,
    privateKeyPem: params.credentials.privateKeyPem,
  });

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
  return { accepted: false, response: result.data, reason: extractRejectionReasons(result.data), signedXml, invoiceHash };
}
