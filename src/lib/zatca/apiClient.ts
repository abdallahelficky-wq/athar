// عميل HTTP لواجهة فاتورة (Fatoora API) — ثلاث بيئات على نفس المضيف gw-fatoora.zatca.gov.sa بمسارات
// مختلفة (بحسب أحدث بحث متاح وقت كتابة هذا الملف؛ لم يتسنَّ التحقق المباشر من هذه المسارات لأن
// الوصول لشبكة زاتكا محجوب من بيئة التطوير هذه — يجب التحقق من توثيق بوابة المطورين الرسمية قبل
// أول استخدام فعلي، خصوصاً مسار الإنتاج): sandbox = بوابة مطورين عامة (شهادات/بيانات وهمية للاختبار
// فقط)، simulation = محاكاة بحساب الشركة الحقيقي (OTP حقيقي) لكن غير ملزمة قانونياً، production =
// البيئة الفعلية الملزمة قانونياً.

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
}

interface RequestParams {
  environment: ZatcaApiEnvironment;
  path: string;
  body: unknown;
  credentials?: ZatcaApiCredentials;
  otp?: string;
  clearanceStatus?: "0" | "1";
}

async function zatcaRequest<T>(params: RequestParams): Promise<ZatcaApiResponse<T>> {
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

  let data: T | null = null;
  try {
    data = (await response.json()) as T;
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

export interface ComplianceCsidResponse {
  requestID: number;
  dispositionMessage?: string;
  binarySecurityToken: string;
  secret: string;
}

/** يطلب شهادة الاختبار (Compliance CSID) — يتطلب CSR و OTP يحصل عليهما مسؤول الشركة من بوابة فاتورة الحقيقية */
export function requestComplianceCsid(environment: ZatcaApiEnvironment, csrBase64: string, otp: string) {
  return zatcaRequest<ComplianceCsidResponse>({ environment, path: "/compliance", body: { csr: csrBase64 }, otp });
}

export interface ProductionCsidResponse {
  requestID: number;
  dispositionMessage?: string;
  binarySecurityToken: string;
  secret: string;
}

/** يستبدل request_id الخاص بشهادة الاختبار بشهادة إنتاج فعلية (صالحة ~سنة) */
export function requestProductionCsid(environment: ZatcaApiEnvironment, credentials: ZatcaApiCredentials, complianceRequestId: string) {
  return zatcaRequest<ProductionCsidResponse>({
    environment,
    path: "/production/csids",
    body: { compliance_request_id: complianceRequestId },
    credentials,
  });
}

export interface ZatcaValidationMessage {
  type: string;
  code?: string;
  category?: string;
  message: string;
}

export interface ZatcaSubmissionResponse {
  clearanceStatus?: string;
  reportingStatus?: string;
  validationResults?: {
    infoMessages?: ZatcaValidationMessage[];
    warningMessages?: ZatcaValidationMessage[];
    errorMessages?: ZatcaValidationMessage[];
    status?: string;
  };
  /** موجود فقط على استجابة التخليص الناجحة — QR/الختم المُختوَم من زاتكا نفسها للفواتير القياسية */
  clearedInvoice?: string;
}

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
  return zatcaRequest<ZatcaSubmissionResponse>({
    environment: params.environment,
    path: "/compliance/invoices",
    body: { invoiceHash: params.invoiceHash, uuid: params.uuid, invoice: params.signedInvoiceBase64 },
    credentials: params.credentials,
  });
}

/** الإبلاغ (Reporting) — للفواتير المبسّطة B2C؛ تُسلَّم للعميل فوراً ويُبلَّغ عنها لاحقاً خلال 24 ساعة */
export function reportInvoice(params: SubmitInvoiceParams) {
  return zatcaRequest<ZatcaSubmissionResponse>({
    environment: params.environment,
    path: "/invoices/reporting/single",
    body: { invoiceHash: params.invoiceHash, uuid: params.uuid, invoice: params.signedInvoiceBase64 },
    credentials: params.credentials,
    clearanceStatus: "0",
  });
}

/** التخليص (Clearance) — للفواتير القياسية B2B؛ يجب قبولها من زاتكا قبل تسليمها للعميل */
export function clearInvoice(params: SubmitInvoiceParams) {
  return zatcaRequest<ZatcaSubmissionResponse>({
    environment: params.environment,
    path: "/invoices/clearance/single",
    body: { invoiceHash: params.invoiceHash, uuid: params.uuid, invoice: params.signedInvoiceBase64 },
    credentials: params.credentials,
    clearanceStatus: "1",
  });
}

/** يستخرج رسائل الأخطاء بصيغة نص عربي واحد قابل للعرض مباشرة للمستخدم من استجابة رفض */
export function extractRejectionReasons(response: ZatcaSubmissionResponse | null): string {
  const errors = response?.validationResults?.errorMessages ?? [];
  if (!errors.length) return "رفضت زاتكا الفاتورة بلا تفاصيل إضافية";
  return errors.map((e) => e.message).join("؛ ");
}
