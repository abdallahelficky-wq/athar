import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { buildQrBaseParams, reserveZatcaChain, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "./chain";
import { loadCompanyZatcaCredentials, zatcaEnvironmentMismatchMessage } from "./credentials";
import { resolveZatcaSubmissionKind, signAndSubmitDocument } from "./submission";
import { ZatcaApiEnvironment } from "./apiClient";
import { ZatcaDocumentKind } from "./types";

type Tx = Prisma.TransactionClient;

export type ZatcaPostingStatus =
  | "not_applicable"
  | "pending_clearance"
  | "cleared"
  | "pending_reporting"
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
  /** فقط لو حُجزت سلسلة ICV/PIH فعلياً (الشركة مرتبطة بزاتكا) — تُعبَّأ بصرف النظر عن نتيجة
   * القبول/الرفض، لأن أي حجز فعلي يعني عداد ICV الشركة تقدَّم بالفعل. يُستخدَم فقط لتسجيل "فجوة
   * سلسلة" صريحة لو فشلت كتابة المستند النهائية بعد هذه النقطة لسبب غير متوقَّع — راجع
   * recordZatcaChainGap في salesInvoices.service.ts. */
  reservedChain?: { icv: number; invoiceHash: string };
}

export interface EvaluateZatcaPostingGateParams {
  /**
   * مُمرَّرة فقط من المسارات القديمة التي لم تُعَد هيكلتها بعد (salesReturns/salesDebitNotes
   * حالياً) — تحجز سلسلة ICV/PIH ضمن معاملة الكتابة النهائية نفسها للمستدعي، فيحدث الاتصال
   * الشبكي الفعلي بزاتكا (signAndSubmitDocument) وتلك المعاملة لا تزال مفتوحة — بنفس المخاطر
   * التي سبَّبت عطل إنتاج فعلي (Transaction already closed: A query cannot be executed on an
   * expired transaction) على مسار الفواتير قبل إصلاحه.
   *
   * المسارات المُعاد هيكلتها (createSalesInvoice/postSalesInvoice في salesInvoices.service.ts)
   * لا تُمرِّرها إطلاقاً — عندئذٍ تُحجَز السلسلة هنا في معاملة قصيرة مستقلة خاصة بها، والاتصال
   * بزاتكا يحدث بعدها بلا أي معاملة مفتوحة إطلاقاً؛ معاملة الكتابة النهائية للمستدعي (القيد
   * المحاسبي + سطر المستند) تُفتَح لاحقاً هو نفسه، بعد معرفة قرار زاتكا مسبقاً.
   */
  tx?: Tx;
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
 *
 * ملاحظة أداء/سلامة معاملات: حجز السلسلة (reserveZatcaChain) يحدث دائماً ضمن معاملة قصيرة (إما
 * معاملة المستدعي القديمة إن مُرِّرت tx، أو معاملة مستقلة أُنشئت هنا) — لكن الاتصال الشبكي الفعلي
 * بزاتكا (signAndSubmitDocument) يحدث *بعد* أن تُغلَق تلك المعاملة القصيرة دائماً، بصرف النظر عن
 * وجود tx من عدمه. الفرق الوحيد بين الوضعين: مع tx، معاملة المستدعي نفسها لا تزال مفتوحة أثناء
 * الاتصال الشبكي (تُبقيها البنية القديمة مفتوحة حتى بعد عودة هذه الدالة)؛ بدون tx، لا توجد أي
 * معاملة مفتوحة إطلاقاً في تلك اللحظة.
 */
export async function evaluateZatcaPostingGate(params: EvaluateZatcaPostingGateParams): Promise<ZatcaPostingDecision> {
  const chainParams = {
    company: params.company,
    customer: params.customer,
    kind: params.kind,
    documentNumber: params.documentNumber,
    documentUuid: params.documentUuid,
    billingReferenceId: params.billingReferenceId,
    lines: params.lines,
  };
  const chain = params.tx
    ? await reserveZatcaChain(params.tx, chainParams)
    : await prisma.$transaction((tx) => reserveZatcaChain(tx, chainParams));

  if (!chain) {
    return { proceedWithPosting: true, zatcaFields: { zatcaStatus: "not_applicable" } };
  }
  const reservedChain = { icv: chain.icv, invoiceHash: chain.invoiceHash };

  const environment = params.company.zatcaEnvironment as ZatcaApiEnvironment;
  const loaded = await loadCompanyZatcaCredentials(params.company.id, environment);
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
        reservedChain,
      };
    }
    return {
      proceedWithPosting: true,
      zatcaFields: {
        icv: chain.icv,
        previousInvoiceHash: chain.previousInvoiceHash,
        invoiceHash: chain.invoiceHash,
        zatcaStatus: chain.zatcaStatus,
        zatcaSubmittedAt: chain.issuedAt,
      },
      reservedChain,
    };
  }
  const credentials = loaded.credentials;

  const outcome = await signAndSubmitDocument({
    xml: chain.xml,
    uuid: params.documentUuid,
    environment,
    credentials,
    kind: resolveZatcaSubmissionKind(params.company.zatcaOnboardingStatus, chain.subtype),
    qrBaseParams: buildQrBaseParams(params.company, chain.issuedAt, params.grandTotal, params.vatTotal),
  });

  if (outcome.accepted) {
    // نجاح فعلي على مسار التخليص/الإبلاغ (شهادة إنتاج) فقط يعني cleared/reported — نجاح فحص
    // امتثال (شهادة اختبار) لا يُعتبَر تخليصاً أو إبلاغاً حقيقياً إطلاقاً (المستند لم يُبلَّغ لزاتكا
    // قانونياً بعد)، فيُصنَّف compliance_checked بدلاً من ذلك حتى لو "قُبِل" الفحص نفسه.
    const isProductionSubmission = params.company.zatcaOnboardingStatus === "production";
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
      reservedChain,
    };
  }

  if (!outcome.certificateError && !outcome.networkError && !outcome.httpError) {
    // رفض فعلي وصريح من زاتكا (لا عطل شبكة، لا شهادة معطوبة، لا فشل نقل/مصادقة — تلك الثلاثة لها
    // تصنيفها وسجلّها الخاص، بما فيها السجلّ الكامل داخل zatcaRequest نفسها لحالة httpError) — كان
    // هذا المسار صامتاً تماماً بلا أي سطر سجلّ حتى الآن، فلا وسيلة لمعرفة سبب رفض حقيقي إلا بقراءة
    // zatcaResponseRaw من القاعدة مباشرة. نسجّل الاستجابة الخام الكاملة كما وصلت من زاتكا بلا أي
    // تصفية أو افتراض شكل مسبق — extractRejectionReasons (apiClient.ts) قد لا تلتقط كل شيء لو
    // اختلف شكل استجابة زاتكا الفعلي عمّا افتُرِض في هذا الملف.
    // eslint-disable-next-line no-console
    console.error(
      `[evaluateZatcaPostingGate] رفضت زاتكا مستنداً — الشركة "${params.company.name}" (${params.company.id})، رقم المستند=${params.documentNumber}، ` +
        `documentUuid=${params.documentUuid}، السبب المعروض للمستخدم=${outcome.reason} — الاستجابة الخام الكاملة من زاتكا: ${JSON.stringify(outcome.response)}`,
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
      // فشل نقل/مصادقة (httpError، مثل 401/403/404/5xx أو جسم غير مفهوم) لم تُقيَّم فيه الفاتورة
      // على الإطلاق — تحتاج مراجعة إعداد الربط (شهادة/صلاحيات/مسار)، لا تصحيح بيانات المستند، فتُصنَّف
      // submission_failed بنفس معاملة عطل الشبكة تماماً (راجع httpError في submission.ts/apiClient.ts).
      zatcaStatus: outcome.certificateError ? "certificate_error" : outcome.networkError || outcome.httpError ? "submission_failed" : "rejected",
      zatcaSubmittedAt: chain.issuedAt,
      zatcaResponseRaw: (outcome.response ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    rejectionReason: outcome.reason,
    reservedChain,
  };
}
