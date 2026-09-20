import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { badRequest, notFound } from "../httpError";
import { evaluateZatcaPostingGate } from "./postingGate";
import { ZatcaDocumentKind, ZatcaInvoiceSubtype } from "./types";
import { ZatcaCustomerLike, ZatcaPersistedLineLike } from "./chain";

// أتمتة تشغيل مستندات "فحص الامتثال" الستة الإلزامية التي تشترطها زاتكا قبل شهادة الإنتاج
// (Production CSID) — بمستندات اصطناعية بالكامل، لا تُنشئ أبداً أي SalesInvoice/SalesReturn/
// SalesDebitNote ولا أي JournalEntry (راجع اختبار العزل في complianceAutomation.test.ts). عزل
// الملف نفسه مقصود: كل شيء هنا يستورد فقط من src/lib/zatca/* أو src/lib/prisma — لا استيراد واحد
// من أي moduleخدمة مبيعات، حتى يبقى التحقق من "لا كتابة على الدفاتر" فحصاً بنيوياً بسيطاً (بحث عن
// استيراد) لا مجرد ثقة بالمنطق وقت التشغيل.
//
// الدافع: مستندات الإشعار الدائن/المدين في أثر تتطلب فاتورة مُرحَّلة فعلياً كمرجع (billingReference)
// — تلبية الأنواع الستة عبر مستندات محاسبية حقيقية تعني تلفيق فواتير وقيود في دفاتر الشركة الفعلية،
// وهذا غير مقبول. الحل: تمرير بيانات عميل/سطور مُلفَّقة بالكامل (لا صفوف Customer/Item حقيقية) عبر
// نفس أنبوب زاتكا (evaluateZatcaPostingGate → reserveZatcaChain → signAndSubmitDocument) الذي تستخدمه
// أي فاتورة حقيقية — نفس الأنبوب لضمان بقاء سلسلة ICV/PIH متصلة، لا أنبوب مختلف.

/**
 * الأنواع الستة الإلزامية — راجع ZatcaCsrInvoiceType في schema.prisma. المفاتيح (key) مطابقة
 * حرفياً لتسمية زاتكا نفسها في رفض Missing-ComplianceSteps الفعلي المُستلَم:
 *   {"code":"Missing-ComplianceSteps","message":"...following compliance steps yet
 *    [standard-credit-note-compliant,standard-debit-note-compliant,simplified-compliant,
 *    simplified-credit-note-compliant,simplified-debit-note-compliant]"}
 * "standard-compliant" غائبة عمداً عن تلك القائمة — هي الوحيدة التي اجتازت الفحص فعلاً، بفاتورة
 * قياسية حقيقية سبق ترحيلها، لا مستنداً اصطناعياً من هذا الملف.
 */
export interface ZatcaComplianceStepDefinition {
  key: string;
  kind: ZatcaDocumentKind;
  subtype: ZatcaInvoiceSubtype;
  /**
   * كانت خطوة واحدة فقط (الإشعار الدائن القياسي) مُفعَّلة عمداً في مرحلة أولى، ريثما يُتحقَّق من
   * قبول زاتكا لمرجع ذاتي اصطناعي في الإشعارات (billingReferenceId) — تحقَّق ذلك فعلياً بلا أي
   * اعتراض من زاتكا، فالأربع الباقية (بخلاف standard-compliant المُجتازة فعلاً بفاتورة حقيقية،
   * فلا حاجة لتكرارها اصطناعياً) مُفعَّلة الآن أيضاً. runZatcaComplianceStep يرفض أي خطوة
   * enabled=false صراحة — هذا قيد حقيقي داخل الدالة نفسها، لا مجرد اعتماد على أن الرابط الخارجي
   * (route/controller) لا يعرض غيرها؛ كل خطوة لا تزال تحتاج ضغطة زر مقصودة منفصلة (لا تسلسل تلقائي).
   */
  enabled: boolean;
}

export const ZATCA_COMPLIANCE_STEPS: readonly ZatcaComplianceStepDefinition[] = [
  { key: "standard-compliant", kind: "invoice", subtype: "standard", enabled: false },
  { key: "simplified-compliant", kind: "invoice", subtype: "simplified", enabled: true },
  { key: "standard-credit-note-compliant", kind: "credit_note", subtype: "standard", enabled: true },
  { key: "simplified-credit-note-compliant", kind: "credit_note", subtype: "simplified", enabled: true },
  { key: "standard-debit-note-compliant", kind: "debit_note", subtype: "standard", enabled: true },
  { key: "simplified-debit-note-compliant", kind: "debit_note", subtype: "simplified", enabled: true },
] as const;

/**
 * يستخرج أسماء الخطوات المتبقية من نص رسالة Missing-ComplianceSteps — لا نعتمد على هذا لتتبّع
 * التقدّم (راجع getZatcaComplianceProgress أدناه: السجلّ المحلي هو المصدر الأساسي دائماً)، فقط
 * لتسوية اختيارية عند توفّر رد فعلي منها. تساهلي عمداً (regex بسيط على ما بين قوسين مربّعين، لا
 * محلِّل JSON صارم لحقل message نفسه) لأن الشكل الدقيق للجسم الخام الكامل من زاتكا لم يُتحقَّق منه
 * مباشرة بعد — ما وصل حتى الآن هو نص العرض في واجهة زاتكا، لا الجسم الخام قبل أي عرض.
 */
export function parseMissingComplianceSteps(message: string): string[] {
  const match = message.match(/\[([^\]]*)]/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// بادئة ثابتة لأرقام المستندات الاصطناعية — خارج تماماً أي تسلسل ترقيم حقيقي (formatDocNumber/
// reserveDocumentNumber تستخدمان بادئات مثل SINV/PINV لمستندات حقيقية) — لا تصادم ممكن مع أي رقم
// فاتورة/مردود/إشعار حقيقي، ولا مع بعضها البعض (طابع زمني مُلحَق).
const SYNTHETIC_DOC_NUMBER_PREFIX = "ZATCA-COMPLIANCE-TEST";

// مرجع فاتورة أصل ثابت للإشعارات الدائنة/المدينة الاصطناعية — لم يُرسَل كمستند مستقل فعلياً ولا
// يُطابِق أي مستند حقيقي. زاتكا لا تملك آلية بروتوكولية للتحقق من وجود مرجع سابق فعلياً أثناء فحص
// الامتثال (راجع تقرير التحقيق) — لكن هذا افتراض هيكلي غير مُتحقَّق منه بعد ضد رد فعلي، ولذا هذه أول
// خطوة (الإشعار الدائن القياسي) تُختبَر بمفردها قبل الأربع الباقية.
const SYNTHETIC_BILLING_REFERENCE_ID = "ZATCA-COMPLIANCE-TEST-ORIGINAL-INVOICE";

// BR-KSA-17 (KSA-10): سبب إصدار ثابت وصريح بالعربية يُعلن أنه اختبار امتثال داخلي، لا معاملة
// تجارية فعلية — بنفس منطق SYNTHETIC_PARTY_NAME أدناه (هذه المستندات تصل سجلّ التقديم الدائم لدى
// زاتكا لهذا المكلَّف). إلزامي لإشعار الدائن/المدين فقط — الفاتورة (kind: "invoice") لا تحتاجه.
const SYNTHETIC_ISSUANCE_REASON = "اختبار امتثال داخلي (Athar ERP) — مستند اصطناعي لا يمثّل معاملة تجارية فعلية";

const SYNTHETIC_PARTY_NAME = "ATHAR ZATCA COMPLIANCE TEST — DO NOT PAY / اختبار امتثال داخلي — لا تُسدَّد";

/**
 * عميل مُلفَّق بالكامل — لا صف Customer حقيقي، ولا رقم ضريبي/سجل تجاري يخصّ أي دافع ضريبة فعلي.
 * الاسم يُعلن صراحة أنه اختبار امتثال داخلي بالعربية والإنجليزية معاً — هذه المستندات تصل سجلّ
 * التقديم الدائم لهذا المكلَّف لدى زاتكا (راجع طلب المستخدم)، فيجب أن تُقرَأ كذلك من أي مراجع بشري لاحق.
 */
function syntheticCustomer(subtype: ZatcaInvoiceSubtype): ZatcaCustomerLike {
  if (subtype === "standard") {
    return {
      customerType: "business",
      // شكل صالح شكلياً فقط (15 رقماً، يبدأ/ينتهي بـ3، مطابق لنمط الرقم الضريبي السعودي) — رقم
      // اصطناعي بالكامل، لا يخصّ أي دافع ضريبة فعلي مسجَّل.
      vatNumber: "399999999900003",
      crNumber: null,
      name: SYNTHETIC_PARTY_NAME,
      street: "N/A",
      buildingNo: "0000",
      district: "N/A",
      city: "الرياض",
      postalCode: "00000",
    };
  }
  return {
    customerType: "individual",
    vatNumber: null,
    crNumber: null,
    name: SYNTHETIC_PARTY_NAME,
    street: null,
    buildingNo: null,
    district: null,
    city: null,
    postalCode: null,
  };
}

function syntheticLines(): ZatcaPersistedLineLike[] {
  return [
    {
      description: "ATHAR ZATCA COMPLIANCE TEST LINE — synthetic, never posted to any ledger",
      quantity: 1,
      unitPrice: 1,
      subtotal: 1,
      vat: 0.15,
      taxCategoryCode: "S",
      taxExemptionReason: null,
    },
  ];
}

export interface RunZatcaComplianceStepResult {
  stepKey: string;
  passed: boolean;
  zatcaStatus: string;
  rejectionReason?: string;
  icv: number;
  invoiceHash: string;
  documentNumber: string;
  documentUuid: string;
}

/**
 * يُنفِّذ محاولة فحص امتثال واحدة عبر مستند اصطناعي — تحجز رقم ICV حقيقياً وتُحدِّث سلسلة PIH
 * الفعلية للشركة تماماً كما تفعل أي فاتورة حقيقية (لا مفرّ من ذلك، راجع تقرير التحقيق: هذا هو
 * التصميم الوحيد الذي يُبقي السلسلة متصلة لاحقاً)، ثم تُسجِّل النتيجة محلياً في
 * ZatcaComplianceStepAttempt مربوطة بـcomplianceRequestId الحالي — حتى يبقى التقدّم مرئياً بلا حاجة
 * لاستفزاز رفض شهادة الإنتاج لمعرفته.
 */
export async function runZatcaComplianceStep(tenantId: string, companyId: string, stepKey: string): Promise<RunZatcaComplianceStepResult> {
  const step = ZATCA_COMPLIANCE_STEPS.find((s) => s.key === stepKey);
  if (!step) throw badRequest(`خطوة امتثال زاتكا غير معروفة: ${stepKey}`);
  if (!step.enabled) {
    throw badRequest(
      `خطوة الامتثال "${stepKey}" غير مُفعَّلة للتشغيل بعد — المرحلة الحالية تقتصر عمداً على standard-credit-note-compliant وحدها حتى يُتحقَّق من نتيجتها ضد رد فعلي من زاتكا.`,
    );
  }

  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw notFound("الشركة غير موجودة");
  if (company.zatcaOnboardingStatus === "not_onboarded") {
    throw badRequest("الشركة غير مرتبطة بزاتكا بعد — يجب توليد CSR واستخراج شهادة الاختبار أولاً");
  }

  const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  if (!credential?.complianceRequestId || !credential.complianceCertEnc || !credential.complianceSecretEnc) {
    throw badRequest("لا توجد شهادة اختبار (Compliance CSID) فعّالة لهذه الشركة بعد");
  }

  const documentUuid = randomUUID();
  const documentNumber = `${SYNTHETIC_DOC_NUMBER_PREFIX}-${step.key}-${Date.now()}`;

  const gate = await evaluateZatcaPostingGate({
    company,
    customer: syntheticCustomer(step.subtype),
    kind: step.kind,
    documentNumber,
    documentUuid,
    billingReferenceId: step.kind !== "invoice" ? SYNTHETIC_BILLING_REFERENCE_ID : undefined,
    issuanceReason: step.kind !== "invoice" ? SYNTHETIC_ISSUANCE_REASON : undefined,
    lines: syntheticLines(),
    grandTotal: 1.15,
    vatTotal: 0.15,
  });

  const passed = gate.zatcaFields.zatcaStatus === "compliance_checked";
  const icv = gate.zatcaFields.icv ?? gate.reservedChain?.icv ?? 0;
  const previousInvoiceHash = gate.zatcaFields.previousInvoiceHash ?? "";
  const invoiceHash = gate.zatcaFields.invoiceHash ?? gate.reservedChain?.invoiceHash ?? "";

  await prisma.zatcaComplianceStepAttempt.upsert({
    where: { companyId_complianceRequestId_stepKey: { companyId, complianceRequestId: credential.complianceRequestId, stepKey: step.key } },
    create: {
      tenantId,
      companyId,
      complianceRequestId: credential.complianceRequestId,
      stepKey: step.key,
      kind: step.kind,
      subtype: step.subtype,
      documentNumber,
      documentUuid,
      icv,
      previousInvoiceHash,
      invoiceHash,
      passed,
      rejectionReason: gate.rejectionReason ?? null,
      zatcaResponseRaw: (gate.zatcaFields.zatcaResponseRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
    update: {
      documentNumber,
      documentUuid,
      icv,
      previousInvoiceHash,
      invoiceHash,
      passed,
      rejectionReason: gate.rejectionReason ?? null,
      zatcaResponseRaw: (gate.zatcaFields.zatcaResponseRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      attemptedAt: new Date(),
    },
  });

  // سطر سجلّ مميَّز عمداً — هذا أول اختبار حقيقي لافتراض المرجع الذاتي الاصطناعي على الإشعارات، يجب
  // أن يكون تشخيصه من السجلّات وحدها ممكناً بلا حاجة لقراءة قاعدة البيانات.
  // eslint-disable-next-line no-console
  console.info(
    `[zatcaComplianceStep] ${step.key} — الشركة "${company.name}" (${companyId}) — النتيجة: ${passed ? "نجح" : "فشل"} — ` +
      `ICV=${icv} invoiceHash=${invoiceHash} documentUuid=${documentUuid} documentNumber=${documentNumber}` +
      (gate.rejectionReason ? ` — السبب: ${gate.rejectionReason}` : ""),
  );

  return {
    stepKey: step.key,
    passed,
    zatcaStatus: gate.zatcaFields.zatcaStatus,
    rejectionReason: gate.rejectionReason,
    icv,
    invoiceHash,
    documentNumber,
    documentUuid,
  };
}


export interface ZatcaComplianceProgress {
  complianceRequestId: string | null;
  steps: Array<{ key: string; passed: boolean; enabled: boolean; source: "local_attempt" | "zatca_missing_steps_reconciliation" | "not_yet_attempted" }>;
}

/**
 * تقدّم الأنواع الستة لهذه الشركة — المصدر الأساسي هو السجلّ المحلي (ZatcaComplianceStepAttempt)،
 * مقيَّداً بـcomplianceRequestId الحالي (شهادة اختبار جديدة تُعيد التقدّم من الصفر منطقياً — راجع
 * تعليق الموديل في schema.prisma). لا يستدعي زاتكا إطلاقاً؛ لا حاجة لاستفزاز رفض شهادة الإنتاج
 * لمعرفة التقدّم، تماماً كما طلب المستخدم.
 *
 * تسوية ثانوية فقط (لا يُعتمَد عليها — راجع طلب المستخدم "do not depend on it"): إن وُجدت قائمة
 * lastMissingComplianceSteps محفوظة من رفض فعلي سابق لطلب شهادة الإنتاج (راجع
 * requestCompanyProductionCsid في companiesZatca.service.ts)، أي خطوة لم يُسجَّل لها اجتياز محلي بعد
 * لكنها *غائبة* عن تلك القائمة (أي أن زاتكا نفسها لم تعُد تعتبرها ناقصة) تُعرَض كمُجتازة أيضاً — هذا
 * بالضبط كيف اكتشفنا "standard-compliant" لأول مرة، عبر فاتورة حقيقية لا مستند اصطناعي من هذا الملف.
 */
export async function getZatcaComplianceProgress(tenantId: string, companyId: string): Promise<ZatcaComplianceProgress> {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw notFound("الشركة غير موجودة");

  const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  const complianceRequestId = credential?.complianceRequestId ?? null;

  const attempts = complianceRequestId
    ? await prisma.zatcaComplianceStepAttempt.findMany({ where: { companyId, complianceRequestId } })
    : [];
  const passedKeys = new Set(attempts.filter((a) => a.passed).map((a) => a.stepKey));
  const lastMissing = new Set(credential?.lastMissingComplianceSteps ?? []);
  // "لدينا دليل فعلي من زاتكا" فقط لو رأينا رفضاً حقيقياً بهذه القائمة من قبل — قائمة فارغة (لم
  // نصادف هذا الرفض قط بعد) لا تعني "الكل ناجز"، فتُستبعَد هذه التسوية تماماً في تلك الحالة.
  const hasZatcaEvidence = Boolean(credential?.lastComplianceStepsCheckedAt);

  return {
    complianceRequestId,
    steps: ZATCA_COMPLIANCE_STEPS.map((s) => {
      if (passedKeys.has(s.key)) return { key: s.key, passed: true, enabled: s.enabled, source: "local_attempt" as const };
      if (hasZatcaEvidence && !lastMissing.has(s.key)) return { key: s.key, passed: true, enabled: s.enabled, source: "zatca_missing_steps_reconciliation" as const };
      return { key: s.key, passed: false, enabled: s.enabled, source: "not_yet_attempted" as const };
    }),
  };
}
