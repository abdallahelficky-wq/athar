import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound, HttpError } from "../../lib/httpError";
import { ZatcaApiEnvironment } from "../../lib/zatca/apiClient";
import {
  ZATCA_COMPLIANCE_STEPS,
  runZatcaComplianceStep,
  getZatcaComplianceProgress,
} from "../../lib/zatca/complianceAutomation";
import {
  generateCompanyCsr,
  requestCompanyComplianceCsid,
  requestCompanyProductionCsid,
  setCompanyZatcaEnvironment,
  getZatcaStatus,
} from "./companiesZatca.service";

// الربط بخطوة واحدة: المستخدم يُدخل رمز OTP من منصة فاتورة ويضغط زراً واحداً، والخادم يُنفِّذ بالترتيب
// نفس الدوال الموجودة أصلاً (لا منطق زاتكا جديد هنا إطلاقاً — فقط تنسيق):
//   1. التحقق من اكتمال بيانات المنشأة المطلوبة في الشهادة والفواتير — قبل استهلاك رمز OTP.
//   2. ضبط البيئة المختارة (يمرّ بحارس setCompanyZatcaEnvironment نفسه).
//   3. توليد CSR + طلب شهادة الاختبار بالرمز (generateCompanyCsr ثم requestCompanyComplianceCsid).
//   4. تشغيل اختبارات الامتثال المطلوبة لنوع الفواتير المُعلَن في CSR فقط (runZatcaComplianceStep).
//   5. طلب شهادة الإنتاج (requestCompanyProductionCsid).
//
// الاستئناف: فشل في الخطوة 4 أو 5 لا يُضيِّع شيئاً — شهادة الاختبار تبقى، والضغطة التالية تكمل من حيث
// توقّفت بلا رمز OTP جديد، وتشغّل فقط الاختبارات غير المجتازة.
//
// استثناء مقصود في الاستئناف: إن كانت كل الاختبارات مجتازة سلفاً (أي أن محاولة سابقة بلغت طلب شهادة
// الإنتاج وفشلت فيه) لا نعيد طلب شهادة الإنتاج تلقائياً — رفض هذا الطلب أو انقطاعه (مهلة/شبكة/401)
// يحتاج مراجعة بشرية حسب تعليقات requestCompanyProductionCsid نفسها (رقم طلب الامتثال قد يكون استُهلِك
// لدى زاتكا)، فإعادته آلياً بضغطة زر قد تحرق الطلب. يبقى زر طلب شهادة الإنتاج اليدوي في "الخيارات
// المتقدمة" لمن يراجع.

export type OneStepStageKey = "validate" | "certificate" | "complianceChecks" | "activation";
export type OneStepStageStatus = "done" | "skipped" | "failed" | "pending";

export interface OneStepStage {
  key: OneStepStageKey;
  status: OneStepStageStatus;
}

export interface OneStepOnboardingInput {
  otp?: string;
  environment?: ZatcaApiEnvironment;
}

/** حقول بيانات المنشأة التي تدخل في CSR وفي عنوان البائع بكل فاتورة (BR-KSA-09/37/66 وKSA-2). */
export type MissingCompanyField =
  | "vatNumber"
  | "crNumber"
  | "name"
  | "addressStreet"
  | "addressBuilding"
  | "addressDistrict"
  | "addressCity"
  | "addressPostalCode";

interface CompanyForValidation {
  vatNumber: string | null;
  crNumber: string | null;
  name: string | null;
  addressStreet: string | null;
  addressBuilding: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
}

const blank = (v: string | null | undefined) => !v || !String(v).trim();

/** يُعيد الحقول الناقصة أو غير الصالحة الشكل — قائمة فارغة = جاهزة للربط. */
export function findMissingCompanyFields(company: CompanyForValidation): MissingCompanyField[] {
  const missing: MissingCompanyField[] = [];
  // رقم ضريبي سعودي: 15 رقماً يبدأ وينتهي بـ3
  if (blank(company.vatNumber) || !/^3\d{13}3$/.test(String(company.vatNumber).trim())) missing.push("vatNumber");
  if (blank(company.crNumber)) missing.push("crNumber");
  if (blank(company.name)) missing.push("name");
  if (blank(company.addressStreet)) missing.push("addressStreet");
  // BR-KSA-37: رقم المبنى 4 أرقام
  if (blank(company.addressBuilding) || !/^\d{4}$/.test(String(company.addressBuilding).trim())) missing.push("addressBuilding");
  if (blank(company.addressDistrict)) missing.push("addressDistrict");
  if (blank(company.addressCity)) missing.push("addressCity");
  // BR-KSA-66: الرمز البريدي 5 أرقام
  if (blank(company.addressPostalCode) || !/^\d{5}$/.test(String(company.addressPostalCode).trim())) missing.push("addressPostalCode");
  return missing;
}

/** خطوات الامتثال المطلوبة لنوع الفواتير المُعلَن في CSR — null (صف قديم) يُعامَل كـ"both". */
export function applicableComplianceStepKeys(csrInvoiceType: string | null | undefined): string[] {
  return ZATCA_COMPLIANCE_STEPS.filter((s) => {
    if (!s.enabled) return false;
    if (csrInvoiceType === "standard") return s.subtype === "standard";
    if (csrInvoiceType === "simplified") return s.subtype === "simplified";
    return true;
  }).map((s) => s.key);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// قفل داخل العملية لكل شركة — يمنع ضغطتين متتاليتين من تشغيل سلسلتي ربط متوازيتين تحجزان أرقام ICV
// متداخلة. الخادم الحالي نسخة واحدة على Railway؛ لو تعدّدت النسخ لاحقاً يلزم قفل في قاعدة البيانات.
const inFlight = new Set<string>();

function fail(message: string, stages: OneStepStage[], failedStage: OneStepStageKey, technical: string, extra: Record<string, unknown> = {}): never {
  for (const s of stages) if (s.key === failedStage) s.status = "failed";
  // eslint-disable-next-line no-console
  console.error(`[zatcaOneStepOnboarding] فشل في مرحلة ${failedStage}: ${technical}`);
  throw new HttpError(400, message, { failedStage, stages, technical, ...extra });
}

export async function onboardCompanyZatcaOneStep(tenantId: string, companyId: string, input: OneStepOnboardingInput) {
  if (inFlight.has(companyId)) throw conflict("عملية ربط مع هيئة الزكاة جارية لهذه الشركة بالفعل — انتظر حتى تنتهي");
  inFlight.add(companyId);
  try {
    return await runOneStep(tenantId, companyId, input);
  } finally {
    inFlight.delete(companyId);
  }
}

async function runOneStep(tenantId: string, companyId: string, input: OneStepOnboardingInput) {
  const stages: OneStepStage[] = [
    { key: "validate", status: "pending" },
    { key: "certificate", status: "pending" },
    { key: "complianceChecks", status: "pending" },
    { key: "activation", status: "pending" },
  ];
  const mark = (key: OneStepStageKey, status: OneStepStageStatus) => {
    const s = stages.find((x) => x.key === key);
    if (s) s.status = status;
  };

  let company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw notFound("الشركة غير موجودة");
  if (company.zatcaOnboardingStatus === "production") {
    throw conflict("هذه الشركة مربوطة بالفعل مع هيئة الزكاة");
  }

  // ── 1. بيانات المنشأة ──
  const missingFields = findMissingCompanyFields(company);
  if (missingFields.length) {
    fail(
      "بيانات الشركة غير مكتملة للربط مع هيئة الزكاة — أكمل الحقول الناقصة في بيانات الشركة ثم أعد المحاولة",
      stages,
      "validate",
      `missing: ${missingFields.join(",")}`,
      { missingFields },
    );
  }
  mark("validate", "done");

  // ── 2. البيئة + هل نستأنف؟ ──
  let credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  const hasUsableCompliance =
    company.zatcaOnboardingStatus === "compliance" &&
    Boolean(credential?.complianceRequestId && credential.complianceCertEnc && credential.complianceSecretEnc) &&
    credential?.complianceCsidEnvironment === company.zatcaEnvironment;

  const requestedEnvironment = input.environment ?? (company.zatcaEnvironment as ZatcaApiEnvironment);
  if (requestedEnvironment !== company.zatcaEnvironment) {
    if (hasUsableCompliance) {
      fail(
        "يوجد ربط غير مكتمل على بيئة أخرى — أعد ضبط الربط من الخيارات المتقدمة أولاً ثم أعد المحاولة",
        stages,
        "certificate",
        `requested=${requestedEnvironment} current=${company.zatcaEnvironment}`,
      );
    }
    try {
      await setCompanyZatcaEnvironment(tenantId, companyId, requestedEnvironment);
    } catch (err) {
      fail(
        "تعذّر تغيير بيئة الربط — أعد ضبط الربط من الخيارات المتقدمة أولاً ثم أعد المحاولة",
        stages,
        "certificate",
        errorText(err),
      );
    }
    company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
    if (!company) throw notFound("الشركة غير موجودة");
  }

  // ── 3. الشهادة (CSR + شهادة الاختبار) ──
  if (hasUsableCompliance && requestedEnvironment === company.zatcaEnvironment) {
    mark("certificate", "skipped");
  } else {
    const otp = (input.otp ?? "").trim();
    if (!/^\d{6}$/.test(otp)) {
      throw badRequest("أدخل رمز OTP المكوَّن من 6 أرقام كما يظهر في منصة فاتورة");
    }
    try {
      await generateCompanyCsr(tenantId, companyId, { invoiceType: "both" });
    } catch (err) {
      fail("تعذّر تجهيز شهادة الربط من بيانات الشركة — راجع بيانات الشركة ثم أعد المحاولة", stages, "certificate", errorText(err));
    }
    try {
      await requestCompanyComplianceCsid(tenantId, companyId, otp);
    } catch (err) {
      const technical = errorText(err);
      const otpRejected = /otp/i.test(technical);
      fail(
        otpRejected
          ? "رمز OTP غير صحيح أو انتهت صلاحيته — اطلب رمزاً جديداً من منصة فاتورة وأعد المحاولة"
          : "تعذّر الحصول على الشهادة من هيئة الزكاة — تأكد من رمز OTP والبيئة المختارة ثم أعد المحاولة",
        stages,
        "certificate",
        technical,
      );
    }
    mark("certificate", "done");
    credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  }

  // ── 4. اختبارات الامتثال ──
  const applicable = applicableComplianceStepKeys(credential?.csrInvoiceType);
  const progress = await getZatcaComplianceProgress(tenantId, companyId);
  const passed = new Map(progress.steps.map((s) => [s.key, s.passed]));
  // زاتكا هي المرجع: خطوة سجّلناها محلياً كمجتازة لكن زاتكا أدرجتها ناقصة في آخر رفض تُعاد.
  const zatcaSaysMissing = credential?.lastComplianceStepsCheckedAt ? new Set(credential.lastMissingComplianceSteps ?? []) : new Set<string>();
  const toRun = applicable.filter((key) => !passed.get(key) || zatcaSaysMissing.has(key));

  if (!toRun.length) {
    mark("complianceChecks", "skipped");
    // كل الاختبارات مجتازة قبل هذه الضغطة — محاولة سابقة بلغت طلب شهادة الإنتاج وفشلت. راجع تعليق
    // رأس الملف: لا نعيد هذا الطلب آلياً.
    fail(
      "اكتملت اختبارات الامتثال لكن تفعيل الربط النهائي يحتاج مراجعة فنية قبل إعادة المحاولة — تواصل مع الدعم الفني",
      stages,
      "activation",
      "all compliance steps already passed before this run; automatic production CSID retry is withheld",
    );
  }

  for (const key of toRun) {
    let result;
    try {
      result = await runZatcaComplianceStep(tenantId, companyId, key);
    } catch (err) {
      fail(
        "تعذّر إكمال اختبارات الامتثال مع هيئة الزكاة — أعد المحاولة لاحقاً (لا حاجة لرمز OTP جديد)",
        stages,
        "complianceChecks",
        `${key}: ${errorText(err)}`,
        { failedStep: key },
      );
    }
    if (!result.passed) {
      fail(
        "لم يجتز أحد اختبارات الامتثال لدى هيئة الزكاة — يحتاج مراجعة فنية (لا حاجة لرمز OTP جديد عند إعادة المحاولة)",
        stages,
        "complianceChecks",
        `${key}: ${result.rejectionReason || result.zatcaStatus}`,
        { failedStep: key },
      );
    }
  }
  mark("complianceChecks", "done");

  // ── 5. التفعيل (شهادة الإنتاج) ──
  try {
    await requestCompanyProductionCsid(tenantId, companyId);
  } catch (err) {
    // رسالة الخدمة الأصلية هنا إرشاد فعلي (لا تُعِد المحاولة بعد انقطاع/مهلة…) — تبقى في technical
    // للأدمن، والمستخدم يرى رسالة مبسّطة لا تدفعه لإعادة الضغط.
    fail(
      "اكتملت اختبارات الامتثال لكن تعذّر تفعيل الربط النهائي — لا تُعِد المحاولة، وتواصل مع الدعم الفني لمراجعة حالة الطلب",
      stages,
      "activation",
      errorText(err),
    );
  }
  mark("activation", "done");

  return { stages, status: await getZatcaStatus(tenantId, companyId) };
}
