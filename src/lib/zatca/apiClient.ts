// عميل HTTP لواجهة فاتورة (Fatoora API) — ثلاث بيئات على نفس المضيف gw-fatoora.zatca.gov.sa بمسارات
// مختلفة (بحسب أحدث بحث متاح وقت كتابة هذا الملف؛ لم يتسنَّ التحقق المباشر من هذه المسارات لأن
// الوصول لشبكة زاتكا محجوب من بيئة التطوير هذه — يجب التحقق من توثيق بوابة المطورين الرسمية قبل
// أول استخدام فعلي، خصوصاً مسار الإنتاج): sandbox = بوابة مطورين عامة (شهادات/بيانات وهمية للاختبار
// فقط)، simulation = محاكاة بحساب الشركة الحقيقي (OTP حقيقي) لكن غير ملزمة قانونياً، production =
// البيئة الفعلية الملزمة قانونياً.
//
// بالضبط لأن مسارات/أشكال الاستجابة هذه لم تُتحقَّق مباشرةً بعد: كل استجابة 2xx تُمرَّر على مخطط Zod
// (schema) صريح قبل قبولها كنجاح — رد بكود 2xx لكن بجسم لا يطابق الشكل المتوقَّع (حقل مفقود/نوع غلط/
// جسم فارغ تماماً) يُعامَل كفشل صريح (ok:false, malformedResponse:true)، لا كنجاح صامت. هذا يمنع تحديداً
// تخزين قيمة غير صالحة (مثلاً binarySecurityToken غائب) كأنها شهادة حقيقية — وهو ما تسبَّب فعلياً في
// خطأ ERR_OSSL_ASN1_WRONG_TAG عند محاولة توقيع مستند لاحقاً بشهادة لم تكن قد اجتازت أي تحقق شكلي قط.
import { z } from "zod";

export type ZatcaApiEnvironment = "sandbox" | "simulation" | "production";

const BASE_HOST = "https://gw-fatoora.zatca.gov.sa";

const ENV_PATH_SEGMENT: Record<ZatcaApiEnvironment, string> = {
  sandbox: "e-invoicing/developer-portal",
  simulation: "e-invoicing/simulation",
  production: "e-invoicing/core",
};

function baseUrl(environment: ZatcaApiEnvironment): string {
  return `${BASE_HOST}/${ENV_PATH_SEGMENT[environment]}`;
}

export interface ZatcaApiCredentials {
  /** جسم شهادة CSID بترميز base64 (بلا رأس/تذييل PEM) */
  certificateBodyBase64: string;
  /** سر API المرافق للشهادة (Compliance أو Production) */
  secret: string;
}

/** Authorization: Basic base64(base64(الشهادة):السر) — ترميز مزدوج متعمَّد وفق توثيق زاتكا */
function buildBasicAuthHeader(credentials: ZatcaApiCredentials): string {
  const inner = `${credentials.certificateBodyBase64}:${credentials.secret}`;
  return `Basic ${Buffer.from(inner, "utf8").toString("base64")}`;
}

export interface ZatcaApiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** true فقط عند استجابة HTTP ناجحة (2xx) لكن جسمها لا يطابق المخطط المتوقَّع — يميّز هذه الحالة
   * صراحةً عن رفض فعلي من زاتكا أو فشل اتصال، حتى لا تُعرَض رسالة مضلِّلة ولا تُقبَل بيانات فاسدة. */
  malformedResponse?: boolean;
}

interface RequestParams<T> {
  environment: ZatcaApiEnvironment;
  path: string;
  body: unknown;
  credentials?: ZatcaApiCredentials;
  otp?: string;
  clearanceStatus?: "0" | "1";
  /** يُطبَّق فقط على استجابات 2xx — استجابات الفشل (400/500...) تُعاد كما هي بلا تحقق شكلي، لأن
   * أشكالها متنوّعة (رسائل خطأ عامة من الخادم) ولا تُتخَذ منها قرارات حسّاسة أصلاً. */
  schema: z.ZodType<T>;
}

async function zatcaRequest<T>(params: RequestParams<T>): Promise<ZatcaApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Version": "V2",
    "Accept-Language": "ar",
  };
  if (params.credentials) headers.Authorization = buildBasicAuthHeader(params.credentials);
  if (params.otp) headers.OTP = params.otp;
  if (params.clearanceStatus) headers["Clearance-Status"] = params.clearanceStatus;

  const response = await fetch(`${baseUrl(params.environment)}${params.path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params.body),
  });

  let rawData: unknown = null;
  try {
    rawData = await response.json();
  } catch {
    rawData = null;
  }

  if (!response.ok) {
    return { ok: false, status: response.status, data: rawData as T | null };
  }

  const parsed = params.schema.safeParse(rawData);
  if (!parsed.success) {
    return { ok: false, status: response.status, data: null, malformedResponse: true };
  }
  return { ok: true, status: response.status, data: parsed.data };
}

const csidResponseSchema = z.object({
  requestID: z.number(),
  dispositionMessage: z.string().optional(),
  binarySecurityToken: z.string().trim().min(1),
  secret: z.string().trim().min(1),
});

export type ComplianceCsidResponse = z.infer<typeof csidResponseSchema>;

/** يطلب شهادة الاختبار (Compliance CSID) — يتطلب CSR و OTP يحصل عليهما مسؤول الشركة من بوابة فاتورة الحقيقية */
export function requestComplianceCsid(environment: ZatcaApiEnvironment, csrBase64: string, otp: string) {
  return zatcaRequest({ environment, path: "/compliance", body: { csr: csrBase64 }, otp, schema: csidResponseSchema });
}

export type ProductionCsidResponse = z.infer<typeof csidResponseSchema>;

/** يستبدل request_id الخاص بشهادة الاختبار بشهادة إنتاج فعلية (صالحة ~سنة) */
export function requestProductionCsid(environment: ZatcaApiEnvironment, credentials: ZatcaApiCredentials, complianceRequestId: string) {
  return zatcaRequest({
    environment,
    path: "/production/csids",
    body: { compliance_request_id: complianceRequestId },
    credentials,
    schema: csidResponseSchema,
  });
}

const zatcaValidationMessageSchema = z.object({
  type: z.string(),
  code: z.string().optional(),
  category: z.string().optional(),
  message: z.string(),
});

export type ZatcaValidationMessage = z.infer<typeof zatcaValidationMessageSchema>;

// أي استجابة 2xx حقيقية من زاتكا (نجاح تخليص/إبلاغ) تحمل واحداً على الأقل من هذه الحقول الثلاثة —
// جسم 2xx فارغ أو لا يحمل أياً منها (خطأ بوابة/شبكة أُعيد بكود 2xx خطأً، أو رد لا معنى له) يُرفَض.
const zatcaSubmissionResponseSchema = z
  .object({
    clearanceStatus: z.string().optional(),
    reportingStatus: z.string().optional(),
    validationResults: z
      .object({
        infoMessages: z.array(zatcaValidationMessageSchema).optional(),
        warningMessages: z.array(zatcaValidationMessageSchema).optional(),
        errorMessages: z.array(zatcaValidationMessageSchema).optional(),
        status: z.string().optional(),
      })
      .optional(),
    /** موجود فقط على استجابة التخليص الناجحة — QR/الختم المُختوَم من زاتكا نفسها للفواتير القياسية */
    clearedInvoice: z.string().optional(),
  })
  .refine((v) => v.clearanceStatus !== undefined || v.reportingStatus !== undefined || v.validationResults !== undefined, {
    message: "الاستجابة لا تحتوي على أي من الحقول المتوقَّعة (clearanceStatus/reportingStatus/validationResults)",
  });

export type ZatcaSubmissionResponse = z.infer<typeof zatcaSubmissionResponseSchema>;

interface SubmitInvoiceParams {
  environment: ZatcaApiEnvironment;
  credentials: ZatcaApiCredentials;
  /** XML الموقّع بترميز base64 */
  signedInvoiceBase64: string;
  invoiceHash: string;
  uuid: string;
}

/** فحص امتثال فاتورة تجريبية (مطلوب أثناء الحصول على شهادة الاختبار، قبل شهادة الإنتاج) */
export function checkInvoiceCompliance(params: SubmitInvoiceParams) {
  return zatcaRequest({
    environment: params.environment,
    path: "/compliance/invoices",
    body: { invoiceHash: params.invoiceHash, uuid: params.uuid, invoice: params.signedInvoiceBase64 },
    credentials: params.credentials,
    schema: zatcaSubmissionResponseSchema,
  });
}

/** الإبلاغ (Reporting) — للفواتير المبسّطة B2C؛ تُسلَّم للعميل فوراً ويُبلَّغ عنها لاحقاً خلال 24 ساعة */
export function reportInvoice(params: SubmitInvoiceParams) {
  return zatcaRequest({
    environment: params.environment,
    path: "/invoices/reporting/single",
    body: { invoiceHash: params.invoiceHash, uuid: params.uuid, invoice: params.signedInvoiceBase64 },
    credentials: params.credentials,
    clearanceStatus: "0",
    schema: zatcaSubmissionResponseSchema,
  });
}

/** التخليص (Clearance) — للفواتير القياسية B2B؛ يجب قبولها من زاتكا قبل تسليمها للعميل */
export function clearInvoice(params: SubmitInvoiceParams) {
  return zatcaRequest({
    environment: params.environment,
    path: "/invoices/clearance/single",
    body: { invoiceHash: params.invoiceHash, uuid: params.uuid, invoice: params.signedInvoiceBase64 },
    credentials: params.credentials,
    clearanceStatus: "1",
    schema: zatcaSubmissionResponseSchema,
  });
}

/** يستخرج رسائل الأخطاء بصيغة نص عربي واحد قابل للعرض مباشرة للمستخدم من استجابة رفض */
export function extractRejectionReasons(response: ZatcaSubmissionResponse | null): string {
  const errors = response?.validationResults?.errorMessages ?? [];
  if (!errors.length) return "رفضت زاتكا الفاتورة بلا تفاصيل إضافية";
  return errors.map((e) => e.message).join("؛ ");
}
