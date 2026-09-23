import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { env } from "../../config/env";
import { buildQrBaseParams, reserveZatcaChain, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "./chain";
import { loadCompanyZatcaCredentials, zatcaEnvironmentMismatchMessage } from "./credentials";
import { resolveZatcaSubmissionKind, signAndSubmitDocument } from "./submission";
import { ZatcaApiEnvironment } from "./apiClient";
import { ZatcaDocumentKind } from "./types";

type Tx = Prisma.TransactionClient;

export type ZatcaPostingStatus =
  | "not_applicable"
  /** سلسلة ICV/PIH حُجزت، لكن لم يُرسَل أي طلب لزاتكا إطلاقاً — لا شهادة CSID فعّالة بعد لمرحلة
   * ربط هذه الشركة الحالية (compliance أو production، بحسب zatcaOnboardingStatus). عطل إنتاج فعلي
   * مؤكَّد استبدل هذه الحالة بـpending_clearance/pending_reporting سابقاً (راجع chain.ts): اسمان
   * يوحيان بأن زاتكا استلمت المستند وتُعالجه، بينما الحقيقة أن لا طلب وصلها أصلاً — راجع تعليق
   * isProduction في credentials.ts للعطل الذي أنتج هذا الفرع فعلياً. الاسم هنا مقصود ليكون واضحاً
   * بذاته: لا التباس ممكن مع أي حالة واردة فعلياً من زاتكا. */
  | "not_submitted"
  | "cleared"
  | "reported"
  | "rejected"
  | "submission_failed"
  | "certificate_error"
  /** فحص امتثال ناجح (شركة لا تزال على شهادة اختبار Compliance CSID) — ليس تخليصاً ولا إبلاغاً
   * فعلياً، والمستند لم يُبلَّغ لزاتكا قانونياً بعد. راجع resolveZatcaSubmissionKind في
   * submission.ts؛ يُستبعَد عمداً من ZATCA_AUTO_RETRY_STATUSES في salesInvoices.service.ts (لا
   * معنى لإعادة محاولة تلقائية لفحص امتثال ناجح بالفعل) لكنه مُدرَج في قائمة المتابعة اليدوية
   * (ZATCA_BACKLOG_STATUSES) لأن الشركة تحتاج استكمال الحصول على شهادة إنتاج فعلية لاحقاً. */
  | "compliance_checked";

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
  company: ZatcaCompanyLike;
  customer: ZatcaCustomerLike;
  kind: ZatcaDocumentKind;
  documentNumber: string;
  documentUuid: string;
  billingReferenceId?: string;
  /** BR-KSA-17 (KSA-10) — إلزامي لإشعار دائن/مدين، راجع buildPaymentMeansXml في xmlBuilder.ts */
  issuanceReason?: string;
  lines: ZatcaPersistedLineLike[];
  grandTotal: number;
  vatTotal: number;
}

/**
 * جزء "الإرسال الفعلي" من evaluateZatcaPostingGate — مُعزول عن حجز السلسلة عمداً (راجع
 * reserveZatcaChainForPosting أدناه) حتى تستخدمه مسارات الترحيل الآمنة على ثلاث مراحل
 * (postingPipeline.ts): المرحلة 1 تحجز السلسلة وتكتب الصف أولاً؛ هذه الدالة (المرحلة 2) لا تكتب
 * إلى قاعدة البيانات إطلاقاً — فقط تتصل بزاتكا وتُصنِّف الرد. لا معاملة مفتوحة هنا ولا يمكن أن
 * تكون، لأن هذه الدالة لا تستقبل tx أصلاً.
 */
export async function submitZatcaChainDocument(params: {
  company: ZatcaCompanyLike;
  documentNumber: string;
  documentUuid: string;
  kind: ZatcaDocumentKind;
  chain: { xml: string; subtype: "standard" | "simplified"; icv: number; previousInvoiceHash: string; invoiceHash: string; issuedAt: Date };
  grandTotal: number;
  vatTotal: number;
}): Promise<ZatcaPostingDecision> {
  const { company, documentNumber, documentUuid, kind, chain, grandTotal, vatTotal } = params;
  const environment = company.zatcaEnvironment as ZatcaApiEnvironment;
  const loaded = await loadCompanyZatcaCredentials(company.id, environment, company.zatcaOnboardingStatus);
  if (!loaded.ok) {
    if (loaded.reason === "environment_mismatch") {
      // نفس تصنيف certificate_error تماماً (مشكلة إعداد ربط، لا مشكلة شبكة ولا رفض فعلي من زاتكا،
      // ولن تُحَل نفسها بإعادة المحاولة — تحتاج تدخلاً بشرياً) — راجع zatcaEnvironmentMismatchMessage.
      return {
        proceedWithPosting: chain.subtype !== "standard",
        zatcaFields: {
          icv: chain.icv,
          previousInvoiceHash: chain.previousInvoiceHash,
          invoiceHash: chain.invoiceHash,
          zatcaStatus: "certificate_error",
          zatcaSubmittedAt: chain.issuedAt,
        },
        rejectionReason: zatcaEnvironmentMismatchMessage(loaded.issuedFor, environment),
      };
    }
    // عطل إنتاج فعلي مؤكَّد كان هنا: chain.zatcaStatus (pending_clearance/pending_reporting) كان
    // يُعرَض كأنه حالة واردة من زاتكا نفسها — بينما لا طلب أُرسِل إليها إطلاقاً في هذا الفرع تحديداً
    // (لا شهادة CSID صالحة بعد لمرحلة الشركة الحالية). راجع تعليق not_submitted في types.ts/chain.ts
    // وتعليق isProduction في credentials.ts لتفاصيل العطل الذي أنتج هذا الفرع فعلياً.
    return {
      proceedWithPosting: true,
      zatcaFields: {
        icv: chain.icv,
        previousInvoiceHash: chain.previousInvoiceHash,
        invoiceHash: chain.invoiceHash,
        zatcaStatus: "not_submitted",
        zatcaSubmittedAt: chain.issuedAt,
      },
      rejectionReason:
        "لم يُرسَل هذا المستند إلى هيئة الزكاة والضريبة والجمارك (زاتكا) إطلاقاً — لا توجد شهادة ربط زاتكا (CSID) فعّالة بعد لمرحلة ربط هذه الشركة الحالية. أكمل خطوات ربط زاتكا (CSR ← شهادة اختبار ← شهادة إنتاج) ثم أعد المحاولة.",
    };
  }
  const credentials = loaded.credentials;

  const submissionKind = resolveZatcaSubmissionKind(company.zatcaOnboardingStatus, chain.subtype);
  const outcome = await signAndSubmitDocument({
    xml: chain.xml,
    uuid: documentUuid,
    environment,
    credentials,
    kind: submissionKind,
    qrBaseParams: buildQrBaseParams(company, chain.issuedAt, grandTotal, vatTotal),
    // سقالة تشخيصية مؤقتة (راجع apiClient.ts) — فقط لمسار الامتثال، وفقط عند تفعيل العلَم، أثناء
    // المشي اليدوي الحالي عبر ربط زاتكا. تُزال لاحقاً.
    onboardingDiagnostics:
      env.zatcaOnboardingDiagnostics && submissionKind === "compliance"
        ? {
            companyId: company.id,
            documentKind: kind,
            subtype: chain.subtype,
            icv: chain.icv,
            previousInvoiceHash: chain.previousInvoiceHash,
          }
        : undefined,
  });

  if (outcome.accepted) {
    // نجاح فعلي على مسار التخليص/الإبلاغ (شهادة إنتاج) فقط يعني cleared/reported — نجاح فحص
    // امتثال (شهادة اختبار) لا يُعتبَر تخليصاً أو إبلاغاً حقيقياً إطلاقاً (المستند لم يُبلَّغ لزاتكا
    // قانونياً بعد)، فيُصنَّف compliance_checked بدلاً من ذلك حتى لو "قُبِل" الفحص نفسه.
    const isProductionSubmission = company.zatcaOnboardingStatus === "production";
    return {
      proceedWithPosting: true,
      zatcaFields: {
        icv: chain.icv,
        previousInvoiceHash: chain.previousInvoiceHash,
        invoiceHash: chain.invoiceHash,
        zatcaStatus: isProductionSubmission ? (chain.subtype === "standard" ? "cleared" : "reported") : "compliance_checked",
        zatcaSubmittedAt: chain.issuedAt,
        // تبقى غير مُعرَّفة لفحص امتثال ناجح — الاسم نفسه (Cleared Or Reported) يعني تخليصاً/إبلاغاً
        // قانونياً فعلياً لم يحدث بعد، فلا نملأها بتاريخ زائف يُوهِم لاحقاً بأن المستند بُلِّغ فعلاً.
        ...(isProductionSubmission ? { zatcaClearedOrReportedAt: new Date() } : {}),
        zatcaResponseRaw: (outcome.response ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    };
  }

  if (!outcome.certificateError && !outcome.networkError && !outcome.httpError && !outcome.malformedResponse) {
    // رفض فعلي وصريح من زاتكا (لا عطل شبكة، لا شهادة معطوبة، لا فشل نقل/مصادقة، لا رد 2xx ناجح
    // فعلياً لم يطابق الشكل المتوقَّع — تلك الأربعة لها تصنيفها وسجلّها الخاص، بما فيها السجلّ الكامل
    // داخل zatcaRequest نفسها لحالة httpError) — كان هذا المسار صامتاً تماماً بلا أي سطر سجلّ حتى الآن، فلا وسيلة لمعرفة سبب رفض حقيقي إلا بقراءة
    // zatcaResponseRaw من القاعدة مباشرة. نسجّل الاستجابة الخام الكاملة كما وصلت من زاتكا بلا أي
    // تصفية أو افتراض شكل مسبق — extractRejectionReasons (apiClient.ts) قد لا تلتقط كل شيء لو
    // اختلف شكل استجابة زاتكا الفعلي عمّا افتُرِض في هذا الملف.
    // eslint-disable-next-line no-console
    console.error(
      `[submitZatcaChainDocument] رفضت زاتكا مستنداً — الشركة "${company.name}" (${company.id})، رقم المستند=${documentNumber}، ` +
        `documentUuid=${documentUuid}، السبب المعروض للمستخدم=${outcome.reason} — الاستجابة الخام الكاملة من زاتكا: ${JSON.stringify(outcome.response)}`,
    );
  }

  return {
    // فاتورة قياسية تبقى ممنوعة من الترحيل سواء رفضتها زاتكا صراحةً أو تعذّر الوصول إليها أصلاً أو
    // تعذّر توقيعها محلياً بشهادة غير صالحة أو فشل النقل/المصادقة — التخليص (Clearance) شرط قانوني
    // مسبق في كل هذه الحالات، لا فرق بينها من ناحية قرار الترحيل نفسه (الفرق فقط في تصنيف
    // zatcaStatus أدناه).
    proceedWithPosting: chain.subtype !== "standard",
    zatcaFields: {
      icv: chain.icv,
      previousInvoiceHash: chain.previousInvoiceHash,
      invoiceHash: chain.invoiceHash,
      // "rejected" محجوزة فقط لتقييم فعلي من زاتكا انتهى برفض المستند — تحتاج تصحيح بيانات. أي
      // فشل نقل/مصادقة (httpError، مثل 401/403/404/5xx أو جسم غير مفهوم) أو رد 2xx ناجح فعلياً لم
      // يطابق الشكل المتوقَّع (malformedResponse — عطل إنتاج فعلي مؤكَّد: كان يُصنَّف "rejected" رغم
      // أن زاتكا لم ترفض شيئاً، لأنها لم تُقيَّم فيه الفاتورة على الإطلاق) — تحتاج مراجعة إعداد الربط
      // (شهادة/صلاحيات/مسار) أو تحديث المخطط المتوقَّع، لا تصحيح بيانات المستند، فتُصنَّف
      // submission_failed بنفس معاملة عطل الشبكة تماماً (راجع httpError/malformedResponse في submission.ts/apiClient.ts).
      zatcaStatus: outcome.certificateError
        ? "certificate_error"
        : outcome.networkError || outcome.httpError || outcome.malformedResponse
          ? "submission_failed"
          : "rejected",
      zatcaSubmittedAt: chain.issuedAt,
      zatcaResponseRaw: (outcome.response ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    rejectionReason: outcome.reason,
  };
}

/**
 * حجز سلسلة ICV/PIH فقط (المرحلة 1 من postingPipeline.ts) — دائماً ضمن معاملة قصيرة مستقلة خاصة
 * بها (لا tx خارجي يُقبَل هنا إطلاقاً)، لا اتصال شبكي بزاتكا داخلها مطلقاً. راجع submitZatcaChainDocument
 * أعلاه للاتصال الفعلي بزاتكا بعد أن يُغلَق هذا الحجز.
 */
export async function reserveZatcaChainForPosting(params: {
  company: ZatcaCompanyLike;
  customer: ZatcaCustomerLike;
  kind: ZatcaDocumentKind;
  documentNumber: string;
  documentUuid: string;
  billingReferenceId?: string;
  issuanceReason?: string;
  lines: ZatcaPersistedLineLike[];
}) {
  return prisma.$transaction((tx) => reserveZatcaChain(tx, params));
}

/**
 * البوابة القديمة "دفعة واحدة" (حجز + إرسال معاً) — لا تُستخدَم إلا من complianceAutomation.ts
 * (مستندات اصطناعية بالكامل، لا كتابة محاسبية حقيقية بعدها إطلاقاً، فلا خطر "فجوة" ممكناً هناك أصلاً
 * — راجع تعليق الملف). مسارات الترحيل الحقيقية الثلاثة (فواتير/مردودات/إشعارات مدين) تستخدم
 * reserveZatcaChainForPosting وsubmitZatcaChainDocument منفصلتين عبر postingPipeline.ts بدلاً من
 * هذه الدالة، لأن الصف المحاسبي يجب أن يُكتَب بين المرحلتين (بعد الحجز، قبل الإرسال) — شيء لا تسمح
 * به دالة واحدة تُنفِّذ الاثنين معاً بلا توقف.
 */
export async function evaluateZatcaPostingGate(params: EvaluateZatcaPostingGateParams): Promise<ZatcaPostingDecision> {
  const chain = await reserveZatcaChainForPosting({
    company: params.company,
    customer: params.customer,
    kind: params.kind,
    documentNumber: params.documentNumber,
    documentUuid: params.documentUuid,
    billingReferenceId: params.billingReferenceId,
    issuanceReason: params.issuanceReason,
    lines: params.lines,
  });
  if (!chain) {
    return { proceedWithPosting: true, zatcaFields: { zatcaStatus: "not_applicable" } };
  }
  return submitZatcaChainDocument({
    company: params.company,
    documentNumber: params.documentNumber,
    documentUuid: params.documentUuid,
    kind: params.kind,
    chain,
    grandTotal: params.grandTotal,
    vatTotal: params.vatTotal,
  });
}
