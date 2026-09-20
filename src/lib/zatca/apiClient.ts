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
import { env } from "../../config/env";

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
  /** الشكل القانوني (canonical) لجسم شهادة CSID بترميز base64 (بلا رأس/تذييل PEM) — ما نجح تحليله
   * فعلياً كـX.509 صالح (getCertificateInfo)، يُستخدَم *فقط* للتوقيع (signDocument) — راجع
   * rawCertificateBodyBase64 أدناه لما يُستخدَم في ترويسة المصادقة، وهو مختلف عمداً. */
  certificateBodyBase64: string;
  /** الشكل الخام تماماً كما أعادته زاتكا في binarySecurityToken، بلا أي فك ترميز إضافي — هذا
   * تحديداً ما يجب أن تحمله ترويسة Basic Auth (buildBasicAuthHeader أدناه)، لأن زاتكا تتحقق من
   * الترويسة مقابل القيمة التي أصدرتها هي بالذات، لا أي شكل أُعيد اشتقاقه محلياً. عطل إنتاج فعلي
   * مؤكَّد: استخدام الشكل القانوني هنا بدل الخام (بعد تطبيع شهادة كانت مُرمَّزة base64 مرتين لإصلاح
   * التوقيع) غيَّر قيمة هذه الترويسة عن الشكل الذي أصدرته زاتكا بالضبط، فرفضتها بوابتها بـ401 فارغ
   * الجسم بلا أي علاقة بصحة التوقيع أو صحة الشهادة نفسها. */
  rawCertificateBodyBase64: string;
  /** سر API المرافق للشهادة (Compliance أو Production) */
  secret: string;
}

/** Authorization: Basic base64(الشهادة الخامة:السر) — عمداً rawCertificateBodyBase64 لا
 * certificateBodyBase64: راجع تعليق ZatcaApiCredentials أعلاه لسبب هذا الفصل. */
function buildBasicAuthHeader(credentials: ZatcaApiCredentials): string {
  const inner = `${credentials.rawCertificateBodyBase64}:${credentials.secret}`;
  return `Basic ${Buffer.from(inner, "utf8").toString("base64")}`;
}

export interface ZatcaApiResponse<T> {
  ok: boolean;
  status: number;
  statusText?: string;
  data: T | null;
  /** true فقط عند استجابة HTTP ناجحة (2xx) لكن جسمها لا يطابق المخطط المتوقَّع — يميّز هذه الحالة
   * صراحةً عن رفض فعلي من زاتكا أو فشل اتصال، حتى لا تُعرَض رسالة مضلِّلة ولا تُقبَل بيانات فاسدة. */
  malformedResponse?: boolean;
  /** true فقط لفشل اتصال فعلي (DNS/timeout/رفض اتصال...) قبل وصول أي استجابة HTTP إطلاقاً — يميّز
   * هذه الحالة عن رفض حقيقي من زاتكا، حتى تُعامَل كفشل إرسال مؤقت (نفس مسار malformedResponse) لا
   * كاستثناء غير مُتوقَّع يُسقِط معاملة الترحيل بأكملها. راجع تعليق zatcaRequest أدناه. */
  networkError?: boolean;
  /** true لاستجابة غير ناجحة (non-2xx) وصلت فعلياً (بخلاف networkError) لكنها ليست رفضاً حقيقياً
   * لمحتوى المستند — إما كودها كود نقل/مصادقة/توجيه واضح (401/403/404/5xx) بصرف النظر عن جسمها، أو
   * جسمها لا يحمل بنية رفض معروفة من زاتكا (validationResults بأخطاء/تحذيرات فعلية) إطلاقاً. راجع
   * hasRecognizableRejectionBody أدناه — هذا هو الفرق بين "رفضت زاتكا الفاتورة" (تحتاج تصحيح بيانات)
   * و"تعذّر الوصول لزاتكا بصيغة مفهومة" (تحتاج مراجعة إعداد الربط: شهادة/صلاحيات/مسار). */
  httpError?: boolean;
}

interface RequestParams<T> {
  environment: ZatcaApiEnvironment;
  path: string;
  body: unknown;
  credentials?: ZatcaApiCredentials;
  otp?: string;
  clearanceStatus?: "0" | "1";
  /** لغة رسائل الرفض/الأخطاء التي تُعيدها زاتكا — "ar" افتراضياً (الصحيح للمسارات الحقيقية
   * المُعروضة للمستخدم النهائي: تخليص/إبلاغ فاتورة فعلية). "en" مخصَّصة لتشخيص يدوي فقط (راجع
   * acceptLanguage في checkInvoiceCompliance أدناه) — قالب الرسالة العربية من زاتكا نفسها وصل
   * فعلياً مشوَّهاً نحوياً (علامة اقتباس قبل النقطتين بدل بعدهما) لقاعدة BR-KSA-EN16931-01، مما
   * أعاق تشخيص القيمة المتوقَّعة بدقة عبر عدة محاولات — الإنجليزية هي المصدر غير المُترجَم. */
  acceptLanguage?: "ar" | "en";
  /** يُطبَّق فقط على استجابات 2xx — استجابات الفشل (400/500...) تُعاد كما هي بلا تحقق شكلي، لأن
   * أشكالها متنوّعة (رسائل خطأ عامة من الخادم) ولا تُتخَذ منها قرارات حسّاسة أصلاً. */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** سقالة تشخيصية مؤقتة (راجع env.zatcaOnboardingDiagnostics) — سياق اختياري (ICV/PIH/نوع مستند/
   * فرعه) يُملأه المستدعي وقت المشي اليدوي عبر ربط زاتكا فقط؛ لا يُستخدَم في أي قرار، فقط يُسجَّل
   * كاملاً مع الجسم الخام *قبل* أي تصفية Zod (schema أعلاه قد تُسقِط حقولاً غير معروفة صامتة). */
  onboardingDiagnostics?: Record<string, unknown>;
}

// كانت هذه المهلة غير محدودة إطلاقاً قبل هذا التعديل — وهي بالضبط كيف انتهى بنا الأمر لعطل
// إنتاج فعلي: نداء fetch بلا مهلة داخل معاملة قاعدة بيانات بمهلتها الخاصة (5 ثوانٍ افتراضياً)
// انتهى بـ"Transaction already closed" بمجرد أن أخذت زاتكا وقتاً أطول قليلاً من المعتاد. الآن
// بعد نقل هذا النداء خارج أي معاملة مفتوحة (راجع postingGate.ts)، هذه المهلة تحديداً تحمي المستخدم
// المنتظر أمام الشاشة من انتظار غير محدود لو تعليق شبكة زاتكا نفسها لا مجرد بطء عادي — 15 ثانية
// كافية لزمن استجابة API حكومي طبيعي (بما فيه TLS handshake)، لا مجرد تكرار حد الـ5 ثوانٍ القديم
// الذي كان مقاساً على DB محلية سريعة لا نداءً شبكياً خارجياً.
const ZATCA_REQUEST_TIMEOUT_MS = 15_000;

// سقالة تشخيصية مؤقتة — أسماء الحقول (بغضّ النظر عن حالة الأحرف) التي تُخفى قبل تسجيل أي جسم رد خام
// من زاتكا (راجع onboardingDiagnostics أدناه): binarySecurityToken/secret فعليان في رد /production/csids
// (نفس القيمتين المُخزَّنتين لاحقاً)، clearedInvoice قد يحمل XML موقَّعاً يتضمّن الشهادة العامة. certificate
// وprivateKey مُدرَجان احتياطاً لو أعادت زاتكا حقلاً بهذا الاسم لم نتوقعه صراحةً.
const ONBOARDING_DIAGNOSTICS_REDACTED_KEYS = new Set(["binarysecuritytoken", "secret", "clearedinvoice", "certificate", "privatekey"]);

function redactSensitiveOnboardingDiagnosticsFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveOnboardingDiagnosticsFields);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = ONBOARDING_DIAGNOSTICS_REDACTED_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactSensitiveOnboardingDiagnosticsFields(v);
    }
    return out;
  }
  return value;
}

// سقالة تشخيصية مؤقتة — يستخرج XML المُرسَل فعلياً (بعد التوقيع وحقن QR) من جسم الطلب، لا الرد،
// لإثبات ما وصل زاتكا فعلاً بايتاً بايت — لا نص وسيط أُعيد بناؤه محلياً. آمن للتسجيل كاملاً بلا
// اقتطاع ولا إخفاء: هذا محتوى وثيقتنا نفسها (بما فيها الشهادة العامة ضمن توقيع XAdES — مادة مفتاح
// عام مصمَّمة للنشر، لا سرّاً)، لا رد زاتكا الذي قد يحمل حقولاً غير متوقَّعة.
function extractTransmittedXmlFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const invoice = (body as Record<string, unknown>).invoice;
  if (typeof invoice !== "string" || !invoice) return null;
  try {
    return Buffer.from(invoice, "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function zatcaRequest<T>(params: RequestParams<T>): Promise<ZatcaApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Version": "V2",
    "Accept-Language": params.acceptLanguage ?? "ar",
  };
  if (params.credentials) headers.Authorization = buildBasicAuthHeader(params.credentials);
  if (params.otp) headers.OTP = params.otp;
  if (params.clearanceStatus) headers["Clearance-Status"] = params.clearanceStatus;

  let response: Response;
  try {
    response = await fetch(`${baseUrl(params.environment)}${params.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(ZATCA_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // فشل اتصال حقيقي (DNS/timeout/رفض اتصال/شهادة TLS...) — بلا هذا الالتقاط كان يسقط كاستثناء
    // خام غير مُعالَج يُسقِط معاملة Prisma بأكملها (بما فيها فاتورة نقطة بيع مبسّطة كانت ستُرحَّل
    // بصرف النظر عن نتيجة هذا الإرسال أصلاً — راجع تعليق proceedWithPosting في postingGate.ts:
    // chain.subtype !== "standard" يعني أن الفواتير المبسّطة تُرحَّل دائماً حتى لو رفضتها زاتكا
    // صراحةً، فلا يوجد أي سبب يجعل *فشل الاتصال* تحديداً أخطر من *الرفض الصريح* ويستحق إسقاط كل
    // العملية). يُعامَل هنا كفشل إرسال صريح بدل ذلك، بنفس مسار malformedResponse تماماً.
    // eslint-disable-next-line no-console
    console.error("فشل اتصال بخادم زاتكا (Fatoora):", err);
    return { ok: false, status: 0, data: null, networkError: true };
  }

  // نقرأ الجسم كنص خام أولاً، قبل أي محاولة تحليل JSON — إعادة إنتاج عطل إنتاج فعلي: جسم فارغ أو
  // غير JSON (شائع لردود مصادقة/توجيه 401/403/404 من بوابات API) يجعل response.json() ترمي، فكان
  // الجسم المُحلَّل يُصبح null بلا أي وسيلة لمعرفة السبب الفعلي لاحقاً — لا حتى كود الحالة نفسه، لأن
  // شيئاً لم يكن يُسجِّل الصورة الكاملة (status/statusText/الترويسات/الجسم الخام) على الإطلاق.
  const rawText = await response.text().catch(() => "");
  let rawData: unknown = null;
  try {
    rawData = rawText ? JSON.parse(rawText) : null;
  } catch {
    rawData = null;
  }

  // سقالة تشخيصية مؤقتة — راجع تعليق onboardingDiagnostics في RequestParams وenv.zatcaOnboardingDiagnostics.
  // عمداً هنا قبل أي تصفية Zod (النجاح أدناه يُمرِّر عبر schema.safeParse الذي يُسقِط حقولاً غير
  // معلنة صامتاً) — هذا بالضبط ما قد يُخفي مؤشر تقدّم عبر الأنواع الستة لو أعادته زاتكا فعلياً في
  // حقل لم نتوقعه. يُزال هذا السطر بعد انتهاء المشي اليدوي الحالي عبر ربط زاتكا.
  //
  // مع ذلك: جسم /production/csids يحمل binarySecurityToken/secret الفعليين (نفس القيمتين اللتين
  // تُخزَّنان بعد التشفير لحظات لاحقة)، وجسم /compliance قد يحمل clearedInvoice (XML موقَّع يتضمّن
  // الشهادة العامة داخل توقيع XAdES). تسجيل هذين خاماً يُسرِّب مادة اعتماد/شهادة فعلية إلى سجلّات
  // التطبيق — لذا تُخفى الحقول الحسّاسة المعروفة أدناه قبل التسجيل، لا الجسم الخام كما هو.
  if (env.zatcaOnboardingDiagnostics && params.onboardingDiagnostics) {
    const redactedBody =
      rawData !== null
        ? JSON.stringify(redactSensitiveOnboardingDiagnosticsFields(rawData))
        : "(تعذّر تحليل الجسم كـJSON — لا يُسجَّل نصاً خاماً تفادياً لاحتمال احتوائه على شهادة/سرّ في حقل لم نتعرّف على اسمه)";
    // أيّ شكل شهادة اعتُمِد فعلياً في ترويسة Basic Auth لهذا الطلب — طول كل شكل فقط ومقارنة
    // منطقية (تساوٍ من عدمه)، لا القيمة نفسها إطلاقاً — يُجيب مباشرة من السجلّ وحده هل شهادة هذه
    // الشركة كانت "مفردة" (raw === canonical، لا مشكلة) أو "مزدوجة" الترميز (raw !== canonical،
    // وهذا بالضبط ما قد يفسِّر 401 فارغاً سابقاً على /compliance/invoices لو استُخدِم الشكل الخطأ).
    const authCertForm = params.credentials
      ? {
          rawLength: params.credentials.rawCertificateBodyBase64.length,
          canonicalLength: params.credentials.certificateBodyBase64.length,
          rawEqualsCanonical: params.credentials.rawCertificateBodyBase64 === params.credentials.certificateBodyBase64,
        }
      : "(بلا بيانات اعتماد على هذا الطلب — راجع otp أعلاه)";
    // XML المُرسَل فعلياً في هذا الطلب (بعد التوقيع وحقن QR) — كاملاً بلا اقتطاع، لإثبات وجود
    // cbc:ProfileID وموضعه وقيمته وعدد تكراره في البايتات الفعلية المرسَلة، لا نسخة مُعاد بناؤها.
    const transmittedXml = extractTransmittedXmlFromBody(params.body);
    // eslint-disable-next-line no-console
    console.log(
      `[zatca-onboarding-diagnostics] المسار=${params.path} status=${response.status} Accept-Language=${params.acceptLanguage ?? "ar"} السياق=${JSON.stringify(params.onboardingDiagnostics)} ` +
        `شكل_شهادة_المصادقة=${JSON.stringify(authCertForm)} — ` +
        `الجسم بعد إخفاء الحقول الحسّاسة المعروفة (binarySecurityToken/secret/clearedInvoice/certificate/privateKey): ${redactedBody.slice(0, 10000)}` +
        (transmittedXml ? ` — XML المُرسَل فعلياً (كامل، بعد التوقيع وحقن QR): ${transmittedXml}` : ""),
    );
  }

  if (!response.ok) {
    // عمداً بلا أي تحقق schema هنا (بخلاف فرع النجاح أدناه) — جسم رفض حقيقي من زاتكا يُخزَّن كاملاً
    // كما وصل بلا أي تصفية أو رفض شكلي (يُحفَظ لاحقاً كما هو في zatcaResponseRaw)، مهما كان شكله
    // الفعلي. لا نعرف بعد يقيناً أن zatcaSubmissionResponseSchema أدناه يطابق شكل رفض زاتكا الحقيقي
    // (لم يُتحقَّق منه مباشرة ضد رفض حقيقي وقت كتابة هذا الملف، راجع التعليق أعلى الملف) — التحقّق
    // الشكلي في extractRejectionReasons يتعامل مع هذا بالتساهل بدل الرفض الصامت للبيانات هنا.
    //
    // السجلّ هنا هو الصورة الكاملة لأي استجابة غير ناجحة من زاتكا — status/statusText/الترويسات/
    // الجسم الخام كنص قبل أي تحليل — على كل نداء زاتكا بلا استثناء (إصدار شهادة، تخليص، إبلاغ...).
    const headersObject: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObject[key] = value;
    });
    // eslint-disable-next-line no-console
    console.error(
      `[zatcaRequest] استجابة غير ناجحة من زاتكا — المسار=${params.path} status=${response.status} ${response.statusText} — ` +
        `الترويسات: ${JSON.stringify(headersObject)} — الجسم الخام (نص، قبل أي تحليل): ${rawText.slice(0, 2000)}`,
    );

    // "رفضت زاتكا الفاتورة" (rejected) يعني أنها قيَّمت المستند فعلياً ورفضته — يحتاج تصحيح بيانات.
    // أي شيء آخر (كود مصادقة/توجيه واضح 401/403/404/5xx بصرف النظر عن الجسم، أو جسم لا يحمل بنية
    // رفض معروفة إطلاقاً) هو فشل نقل/مصادقة/إعداد، لا رفض فعلي لمحتوى المستند — راجع httpError أعلاه.
    const isTransportOrAuthStatus = response.status === 401 || response.status === 403 || response.status === 404 || response.status >= 500;
    const httpError = isTransportOrAuthStatus || !hasRecognizableRejectionBody(rawData);

    return { ok: false, status: response.status, statusText: response.statusText, data: rawData as T | null, httpError };
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
export function requestProductionCsid(
  environment: ZatcaApiEnvironment,
  credentials: ZatcaApiCredentials,
  complianceRequestId: string,
  /** سقالة تشخيصية مؤقتة — راجع onboardingDiagnostics في RequestParams أعلاه. */
  onboardingDiagnostics?: Record<string, unknown>,
) {
  return zatcaRequest({
    environment,
    path: "/production/csids",
    body: { compliance_request_id: complianceRequestId },
    credentials,
    schema: csidResponseSchema,
    onboardingDiagnostics,
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

// Observed on /compliance/invoices (2026-09-20): HTTP 202, CLEARED,
// validationResults.status=WARNING, no errors, and reportingStatus=null.
// Normalize only nullable status placeholders on this endpoint; retain the
// existing schema and its non-empty response check for every other field.
const zatcaComplianceResponseSchema = z.preprocess((data) => {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const normalized = { ...data } as Record<string, unknown>;
  for (const field of ["clearanceStatus", "reportingStatus"]) {
    if (normalized[field] === null) delete normalized[field];
  }
  return normalized;
}, zatcaSubmissionResponseSchema);

interface SubmitInvoiceParams {
  environment: ZatcaApiEnvironment;
  credentials: ZatcaApiCredentials;
  /** XML الموقّع بترميز base64 */
  signedInvoiceBase64: string;
  invoiceHash: string;
  uuid: string;
  /** سقالة تشخيصية مؤقتة — راجع onboardingDiagnostics في RequestParams أعلاه. */
  onboardingDiagnostics?: Record<string, unknown>;
  /** راجع acceptLanguage في RequestParams أعلاه — تمرَّر كما هي، "ar" افتراضياً إن أُغفِلت. */
  acceptLanguage?: "ar" | "en";
}

// تصحيح لمحاولة سابقة: كنا نظنّ /compliance (بلا /invoices) هو المسار الصحيح لفحص امتثال الفاتورة،
// بناءً على أن استجابة "Invalid-OTP" على /compliance بدت كرفض تطبيقي حقيقي (بخلاف 401 الفارغ من
// Cloudflare على /compliance/invoices). دليل السجلّ التشخيصي (onboardingDiagnostics) صحَّح هذا:
// إرسال فاتورة فعلية إلى /compliance أعاد "Missing-OTP" — أي أن /compliance تُفسِّر أي طلب إليها،
// حتى بجسم فاتورة، كطلب إصدار شهادة اختبار (CSID) يحتاج OTP، لأنها *هي* مسار إصدار CSID نفسه، لا
// مسار مشترك يُميَّز بنوع المصادقة كما ظُنَّ. فـ/compliance/invoices كان المسار الصحيح للفحص طوال
// الوقت، والـ401 الفارغ عليه سببه المرجَّح شكل شهادة مختلف في ترويسة Basic Auth (راجع
// rawCertificateBodyBase64 في ZatcaApiCredentials أعلاه) لا خطأ في المسار — لم يُتحقَّق من هذا بعد
// بشكل قاطع، ينتظر تأكيداً من المحاولة التالية عبر onboardingDiagnostics.
/** فحص امتثال فاتورة تجريبية (مطلوب أثناء الحصول على شهادة الاختبار، قبل شهادة الإنتاج) — Basic auth
 * بشهادة الاختبار (compliance CSID)، لا ترويسة OTP (تلك فقط لإصدار الشهادة نفسها عبر /compliance). */
export function checkInvoiceCompliance(params: SubmitInvoiceParams) {
  return zatcaRequest({
    environment: params.environment,
    path: "/compliance/invoices",
    body: { invoiceHash: params.invoiceHash, uuid: params.uuid, invoice: params.signedInvoiceBase64 },
    credentials: params.credentials,
    schema: zatcaComplianceResponseSchema,
    onboardingDiagnostics: params.onboardingDiagnostics,
    acceptLanguage: params.acceptLanguage,
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

function getValidationResults(data: unknown): { errorMessages?: unknown; warningMessages?: unknown } | undefined {
  return (data as { validationResults?: unknown } | null)?.validationResults as
    | { errorMessages?: unknown; warningMessages?: unknown }
    | undefined;
}

/** true فقط لو حمل جسم الاستجابة بنية رفض حقيقية معروفة من زاتكا (أخطاء أو تحذيرات فعلية ضمن
 * validationResults) — يميّز رفضاً فعلياً لمحتوى المستند عن استجابة فشل نقل/مصادقة لا علاقة لها
 * بتقييم المستند إطلاقاً (401/403/404/5xx، أو أي جسم فارغ/غير مفهوم). راجع zatcaRequest أعلاه. */
export function hasRecognizableRejectionBody(data: unknown): boolean {
  const validationResults = getValidationResults(data);
  const errorMessages = Array.isArray(validationResults?.errorMessages) ? validationResults!.errorMessages : [];
  const warningMessages = Array.isArray(validationResults?.warningMessages) ? validationResults!.warningMessages : [];
  return errorMessages.length > 0 || warningMessages.length > 0;
}

/** true فقط لو حمل جسم الاستجابة أخطاء فعلية (لا تحذيرات فقط) ضمن validationResults.errorMessages —
 * أدق من hasRecognizableRejectionBody أعلاه (التي تُحسَب فيها التحذيرات أيضاً كـ"بنية رفض معروفة").
 * تُستخدَم تحديداً للتحقّق من فحص الامتثال (checkInvoiceCompliance، مسار /compliance/invoices): زاتكا قد تُعيد HTTP 200 حتى لو
 * فشل الفحص فعلياً (خلافاً لنقطتَي التخليص/الإبلاغ الحقيقيتين حيث يعني الرفض كوداً غير 2xx) — لا
 * نعرف ذلك بيقين تام (لم يُتحقَّق منه مباشرة ضد استجابة حقيقية)، فهذا فحص إضافي دفاعي على محتوى
 * الجسم نفسه، بصرف النظر عن كود HTTP، ليعمل بشكل صحيح أياً كان سلوك زاتكا الفعلي. */
export function hasValidationErrors(data: unknown): boolean {
  const validationResults = getValidationResults(data);
  const errorMessages = Array.isArray(validationResults?.errorMessages) ? validationResults!.errorMessages : [];
  return errorMessages.length > 0;
}

function formatValidationMessage(m: unknown): string {
  if (m && typeof m === "object") {
    const obj = m as Record<string, unknown>;
    const code = typeof obj.code === "string" && obj.code ? `[${obj.code}] ` : "";
    const message = typeof obj.message === "string" ? obj.message : JSON.stringify(obj);
    return `${code}${message}`;
  }
  return String(m);
}

/**
 * يستخرج رسائل الأخطاء بصيغة نص عربي واحد قابل للعرض مباشرة للمستخدم من استجابة رفض — يتضمّن كود
 * كل خطأ (لا الرسالة فقط)، وسطراً مرقَّماً لكل خطأ حتى تبقى مقروءة مع تعدُّد الأخطاء، لا جملة واحدة
 * مدموجة بلا تمييز.
 *
 * response هنا **غير مُتحقَّق منه فعلياً** ضد zatcaSubmissionResponseSchema وقت التشغيل — استجابات
 * الرفض تمر بلا أي schema.safeParse إطلاقاً (راجع zatcaRequest أعلاه)، فقد يختلف شكل رفض زاتكا
 * الحقيقي عمّا افتُرِض هنا (لم يُتحقَّق منه مباشرة ضد رفض حقيقي وقت كتابة هذا الملف). لذلك: كل قراءة
 * حقل هنا دفاعية (duck-typing لا ثقة بنوع TypeScript المُعلَن)، ولو لم نجد أخطاء ولا تحذيرات بالشكل
 * المتوقَّع، تُعرَض الاستجابة الخام كاملة بدل رسالة عامة عديمة الفائدة — هذا تحديداً ما جعل رفضاً
 * حقيقياً يظهر للمستخدم كـ"بلا تفاصيل إضافية" سابقاً، بلا أي معلومة فعلية يمكن التصرّف بناءً عليها.
 */
export function extractRejectionReasons(response: ZatcaSubmissionResponse | null): string {
  const validationResults = getValidationResults(response);

  const errorMessages = Array.isArray(validationResults?.errorMessages) ? (validationResults!.errorMessages as unknown[]) : [];
  if (errorMessages.length) {
    // ترقيم فقط عند تعدُّد الأخطاء — خطأ واحد لا يحتاج "1." لا فائدة منها، ويبقى قابلاً للقراءة أكثر بدونها.
    if (errorMessages.length === 1) return formatValidationMessage(errorMessages[0]);
    return errorMessages.map((e, i) => `${i + 1}. ${formatValidationMessage(e)}`).join(" | ");
  }

  const warningMessages = Array.isArray(validationResults?.warningMessages) ? (validationResults!.warningMessages as unknown[]) : [];
  if (warningMessages.length) {
    return `رفضت زاتكا الفاتورة (تحذيرات فقط، بلا أخطاء صريحة): ${warningMessages.map((w) => formatValidationMessage(w)).join(" | ")}`;
  }

  if (response) {
    return `رفضت زاتكا الفاتورة (شكل الاستجابة لا يطابق أي بنية أخطاء معروفة) — الاستجابة الكاملة: ${JSON.stringify(response)}`;
  }
  return "رفضت زاتكا الفاتورة بلا أي استجابة قابلة للقراءة";
}
