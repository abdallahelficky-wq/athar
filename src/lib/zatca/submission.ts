import { signDocument } from "./signing";
import { buildSignedQrPayload, ZatcaQrUnsignedParams } from "./qr";
import {
  checkInvoiceCompliance,
  clearInvoice,
  extractRejectionReasons,
  hasValidationErrors,
  reportInvoice,
  ZatcaApiEnvironment,
  ZatcaSubmissionResponse,
} from "./apiClient";
import { ResolvedZatcaCredentials } from "./credentials";

// يجمع بين التوقيع (المرحلة C) والإرسال الفعلي (عميل API أعلاه) في خطوة واحدة — هذا ما يستدعيه
// كل من salesInvoices/salesReturns/salesDebitNotes عند الترحيل فعلياً، بدل أن يكرّر كل موديول نفس
// التسلسل (توقيع → بناء QR → إرسال → تفسير الرد).

export type ZatcaSubmissionKind = "clearance" | "reporting" | "compliance";

/** شركة لا تزال على شهادة اختبار (Compliance CSID) يجب أن تُرسِل عبر مسار الامتثال (/compliance/invoices،
 * مُصادَق بـBasic (شهادة الاختبار:سرّها) لا ترويسة OTP — تلك فقط لإصدار الشهادة نفسها عبر /compliance
 * المنفصل تماماً؛ خطأ Missing-OTP الفعلي عند تجربة /compliance لفاتورة أثبت أن /compliance هو مسار
 * إصدار CSID حصراً) فقط — استخدام clearance/reporting بشهادة اختبار يفشل بـ401 (تأكَّد فعلياً في
 * الإنتاج: شهادة اختبار سليمة الشكل + رفض 401 من مسار التخليص = الشهادة غير مخوَّلة لهذا المسار
 * تحديداً، لا عطل توقيع). */
export function resolveZatcaSubmissionKind(
  onboardingStatus: string,
  subtype: "standard" | "simplified",
): ZatcaSubmissionKind {
  if (onboardingStatus !== "production") return "compliance";
  return subtype === "standard" ? "clearance" : "reporting";
}

export interface SubmitDocumentParams {
  /** XML غير موقّع من buildDocumentXml */
  xml: string;
  uuid: string;
  environment: ZatcaApiEnvironment;
  credentials: ResolvedZatcaCredentials;
  kind: ZatcaSubmissionKind;
  qrBaseParams: ZatcaQrUnsignedParams;
  /** سقالة تشخيصية مؤقتة (راجع env.zatcaOnboardingDiagnostics في apiClient.ts) — يمرّرها المستدعي
   * (postingGate.ts/resubmit.ts، حيث تتوفر ICV/PIH الفعلية لهذا المستند) بلا تعديل حتى تُسجَّل
   * كاملة مع الجسم الخام قبل أي تصفية. تُزال بعد انتهاء المشي اليدوي الحالي عبر ربط زاتكا. */
  onboardingDiagnostics?: Record<string, unknown>;
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
  /** true لاستجابة HTTP وصلت فعلياً من زاتكا (بخلاف networkError) لكنها ليست رفضاً حقيقياً لمحتوى
   * المستند — كود نقل/مصادقة/توجيه واضح (401/403/404/5xx)، أو جسم لا يحمل بنية رفض معروفة من زاتكا
   * إطلاقاً. راجع hasRecognizableRejectionBody في apiClient.ts. تحتاج مراجعة إعداد الربط (شهادة/
   * صلاحيات/مسار)، لا تصحيح بيانات المستند. */
  httpError?: boolean;
  /** كود حالة HTTP الفعلي من زاتكا عند httpError — لعرضه في الرسالة للمستخدم بدل رسالة عامة. */
  httpStatus?: number;
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
  const submit =
    params.kind === "clearance" ? clearInvoice : params.kind === "reporting" ? reportInvoice : checkInvoiceCompliance;
  const result = await submit({
    environment: params.environment,
    credentials: params.credentials,
    signedInvoiceBase64,
    invoiceHash,
    uuid: params.uuid,
    onboardingDiagnostics: params.onboardingDiagnostics,
  });

  if (result.ok) {
    // مسار الامتثال (checkInvoiceCompliance، /compliance) تحديداً قد يردّ 2xx حتى لو "فشل" الفحص منطقياً — زاتكا لا
    // توثّق صراحة أن رفض الامتثال يكون بكود HTTP غير ناجح كما في التخليص/الإبلاغ؛ الأرجح أنه، كونه
    // مساراً تشخيصياً غير مُلزِم، يعيد 200 دائماً ويضع نتيجة الفحص داخل الجسم (validationResults
    // بأخطاء فعلية) بدل تغيير كود الحالة. بما أننا لا نستطيع التحقق من هذا مباشرةً ضد زاتكا الحقيقية
    // من هذه البيئة، نتعامل معه دفاعياً: 2xx بجسم يحمل أخطاء تحقّق فعلية على مسار الامتثال تحديداً
    // لا يُعامَل كقبول — بخلاف clearance/reporting حيث النجاح 2xx يعني قبولاً حقيقياً بلا هذا الفحص
    // الإضافي (زاتكا هناك تستخدم كود الحالة نفسه للتمييز، كما تأكَّد فعلياً من خطأ 401 في الإنتاج).
    if (params.kind === "compliance" && hasValidationErrors(result.data)) {
      return {
        accepted: false,
        response: result.data,
        reason: extractRejectionReasons(result.data),
        signedXml,
        invoiceHash,
      };
    }
    return { accepted: true, response: result.data, signedXml, invoiceHash, qrPayload };
  }
  const reason = result.networkError
    ? "تعذّر الاتصال بخادم هيئة الزكاة والضريبة والجمارك (زاتكا) — حاول لاحقاً أو راجع الدعم الفني"
    : result.malformedResponse
      ? "رد غير متوقع من زاتكا (نجاح HTTP لكن الشكل لا يطابق المتوقَّع) — لم تُعتمَد الاستجابة، حاول لاحقاً أو راجع الدعم الفني"
      : result.httpError
        ? `تعذّر إتمام الإرسال إلى هيئة الزكاة والضريبة والجمارك (زاتكا) — رد الخادم بخطأ نقل أو مصادقة` +
          ` (HTTP ${result.status}${result.statusText ? " " + result.statusText : ""}) لا رفضاً لمحتوى الفاتورة. ` +
          `هذا يعني عادة مشكلة في إعداد الربط مع زاتكا (شهادة/صلاحيات/مسار الإرسال)، لا خطأ في بيانات الفاتورة نفسها — راجع الدعم الفني.`
        : extractRejectionReasons(result.data);
  return {
    accepted: false,
    response: result.data,
    reason,
    signedXml,
    invoiceHash,
    networkError: result.networkError,
    httpError: result.httpError,
    httpStatus: result.status,
  };
}
