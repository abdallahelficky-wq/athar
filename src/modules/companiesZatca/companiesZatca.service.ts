import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { encryptSecret, decryptSecret } from "../../lib/zatca/secretBox";
import { generateCsr, verifyCsrLocally, ZatcaCsrInvoiceType } from "../../lib/zatca/csr";
import { requestComplianceCsid, requestProductionCsid, ZatcaApiEnvironment } from "../../lib/zatca/apiClient";
import { getCertificateInfo } from "../../lib/zatca/signing";
import { resolveZatcaRawCertificate } from "../../lib/zatca/credentials";
import { parseMissingComplianceSteps } from "../../lib/zatca/complianceAutomation";
import { env } from "../../config/env";

const BUSINESS_ACTIVITY_INDUSTRY_LABEL: Record<string, string> = {
  contracting: "مقاولات",
  manufacturing: "صناعة",
  retail: "تجزئة",
  general_trade: "تجارة عامة",
  fuel_stations: "محطات وقود",
  horse_stables: "إسطبلات وإيواء وإعاشة الخيل",
};

async function getCompanyOrThrow(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw notFound("الشركة غير موجودة");
  return company;
}

interface NormalizedZatcaCertificate {
  /** الشكل القانوني — ما نجح تحليله فعلياً كـX.509 صالح، يُخزَّن في complianceCertEnc/productionCertEnc
   * ويُستخدَم فقط للتوقيع. */
  canonical: string;
  /** binarySecurityToken تماماً كما أعادته زاتكا (مُقصوصاً فقط)، بلا أي فك ترميز إضافي — يُخزَّن في
   * complianceCertRawEnc/productionCertRawEnc ويُستخدَم فقط في ترويسة Basic Auth. راجع تعليق
   * ZatcaApiCredentials في apiClient.ts لسبب هذا الفصل (عطل إنتاج فعلي مؤكَّد: دمجهما كسر ترويسة
   * المصادقة بعد تطبيع شهادة كانت مُرمَّزة base64 مرتين). */
  raw: string;
}

/**
 * يتحقق أن binarySecurityToken الذي أعادته زاتكا فعلياً قابل للتحليل كشهادة X.509 صالحة *قبل*
 * تخزينه، ويُعيد شكلَين منفصلَين يجب تخزينهما معاً (راجع NormalizedZatcaCertificate أعلاه) — لا
 * قيمة واحدة كما كان سابقاً. getCertificateInfo (signing.ts) يتسامح تلقائياً مع ترميز base64 مزدوج
 * (حالة حقيقية مُؤكَّدة فعلياً من شركة على الإنتاج — راجع scripts/check-zatca-certificate.ts وتقرير
 * التشخيص المرتبط)، فيُعيد canonicalBodyBase64 مطابقاً لما نجح تحليله فعلياً كـX.509 صالح، بصرف
 * النظر عن الشكل الأصلي كما وصل. لا نطبِّق أي فك ترميز أعمى هنا — الشكل القانوني مُستخرَج فقط من
 * محاولة تحليل فعلية ناجحة، لا تخمين.
 *
 * نُسجِّل أيّ شكل اكتُشِف فعلياً (مفرد أو مزدوج) — لم نُثبِت بعد أيّهما "المعيار" الفعلي لدى زاتكا
 * (قد يختلف بين بيئات، أو يكون غير ثابت حتى لدى زاتكا نفسها)، فهذا السجلّ هو مصدر المعرفة
 * التراكمية حول ذلك مع كل شركة جديدة تُربَط، لا افتراضاً مسبقاً.
 */
function normalizeZatcaCertificate(binarySecurityToken: string, csidLabel: string): NormalizedZatcaCertificate {
  let info;
  try {
    info = getCertificateInfo(binarySecurityToken);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[normalizeZatcaCertificate] ${csidLabel}: الشهادة التي أعادتها زاتكا غير قابلة للتحليل حتى بعد محاولة فك ترميز base64 إضافي، الخطأ الفعلي: ${detail}`);
    throw badRequest(
      `استجابة زاتكا لطلب ${csidLabel} تحتوي شهادة بصيغة غير صالحة (فشل تحليلها كشهادة X.509 حتى بعد محاولة فك ترميز إضافي) — لم تُخزَّن أي بيانات. ` +
        `هذا لا يعني عادة خطأ في هذا الطلب نفسه بقدر ما يعني أن الصيغة المُستلَمة من زاتكا تحتاج مراجعة تقنية. راجع الدعم الفني قبل إعادة المحاولة.`,
    );
  }
  const raw = binarySecurityToken.trim();
  const detectedForm = raw === info.canonicalBodyBase64 ? "مفرد (كما وصلت من زاتكا)" : "مزدوج (احتاجت فك ترميز base64 إضافي)";
  // eslint-disable-next-line no-console
  console.info(`[normalizeZatcaCertificate] ${csidLabel}: شكل ترميز الشهادة المكتشَف من زاتكا = ${detectedForm}`);
  return { canonical: info.canonicalBodyBase64, raw };
}

/**
 * حالة ربط زاتكا لعرضها في واجهة الإعدادات — لا تُرجع أي سرّ مُشفَّر أو مفكوك التشفير إطلاقاً،
 * فقط أعلاماً منطقية (موجود/غير موجود) عن كل عنصر.
 */
export async function getZatcaStatus(tenantId: string, companyId: string) {
  const company = await getCompanyOrThrow(tenantId, companyId);
  const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });

  return {
    onboardingStatus: company.zatcaOnboardingStatus,
    environment: company.zatcaEnvironment,
    egsUuid: company.zatcaEgsUuid,
    solutionName: company.zatcaSolutionName,
    model: company.zatcaModel,
    nextIcv: company.zatcaNextIcv,
    hasHashChain: Boolean(company.zatcaLastInvoiceHash),
    hasCsr: Boolean(credential?.csrPem),
    // نوع الفاتورة المُعلَن في CSR الحالي — null لصفّ لم يُولَّد له CSR بعد إضافة هذا الحقل بعد.
    csrInvoiceType: credential?.csrInvoiceType ?? null,
    hasComplianceCertificate: Boolean(credential?.complianceCertEnc),
    hasProductionCertificate: Boolean(credential?.productionCertEnc),
  };
}

export interface GenerateCsrInput {
  /** Deprecated client flag; CSR template is derived from the stored environment. */
  production?: boolean;
  solutionName?: string;
  model?: string;
  /** يحدّد ما تُخوَّل الشهادة الناتجة توقيعه، وعدد مستندات الامتثال الستة/الثلاثة التي تتطلبها زاتكا
   * لاحقاً — راجع ZatcaCsrInvoiceType في schema.prisma. الافتراضي "both" (الأكثر أماناً: يخوِّل كل
   * أنواع الفواتير، لا أضيق احتياج ممكن). */
  invoiceType?: ZatcaCsrInvoiceType;
}

/** يولّد مفتاح secp256k1 خاص جديد + CSR، ويُخزِّن المفتاح مشفَّراً — يستبدل أي CSR/مفتاح سابق لم يُستخدَم بعد. */
export async function generateCompanyCsr(tenantId: string, companyId: string, input: GenerateCsrInput) {
  const company = await getCompanyOrThrow(tenantId, companyId);
  if (!company.vatNumber) throw badRequest("يجب تعبئة الرقم الضريبي للشركة أولاً من بيانات الشركة");
  if (!company.crNumber) throw badRequest("يجب تعبئة رقم السجل التجاري للشركة أولاً من بيانات الشركة");

  const solutionName = input.solutionName || company.zatcaSolutionName || "AtharAlMuhasabi";
  const model = input.model || company.zatcaModel || "v1";
  // معرّف EGS يبقى ثابتاً عبر إعادة توليد CSR (تجديد الشهادة) طالما هو نفس الجهاز — يُولَّد مرة واحدة فقط.
  const egsUuid = company.zatcaEgsUuid || randomUUID();

  const branchLocation = [company.addressBuilding, company.addressStreet, company.addressCity].filter(Boolean).join(" ") || company.name;
  const branchIndustry = (company.businessActivity && BUSINESS_ACTIVITY_INDUSTRY_LABEL[company.businessActivity]) || "تجارة عامة";
  const invoiceType = input.invoiceType || "both";

  const { privateKeyPem, csrPem } = await generateCsr({
    environment: company.zatcaEnvironment as ZatcaApiEnvironment,
    solutionName,
    egsModel: model,
    egsSerialNumber: egsUuid,
    vatNumber: company.vatNumber,
    branchLocation,
    branchIndustry,
    branchName: company.shortName || company.name,
    taxpayerName: company.name,
    taxpayerProvidedId: company.crNumber,
    invoiceType,
  });

  const csrValid = await verifyCsrLocally(csrPem);
  if (!csrValid) throw badRequest("فشل التحقق المحلي من طلب توقيع الشهادة (CSR) المُولَّد — حاول مرة أخرى");

  await prisma.$transaction([
    prisma.company.update({ where: { id: companyId }, data: { zatcaSolutionName: solutionName, zatcaModel: model, zatcaEgsUuid: egsUuid } }),
    prisma.companyZatcaCredential.upsert({
      where: { companyId },
      create: { companyId, privateKeyEnc: encryptSecret(privateKeyPem), csrPem, csrInvoiceType: invoiceType },
      update: {
        privateKeyEnc: encryptSecret(privateKeyPem),
        csrPem,
        csrInvoiceType: invoiceType,
        complianceCertEnc: null,
        // كانت هذه الحقول (rawEnc) مفقودة من إعادة الضبط عند تجديد CSR منذ إضافتها — شهادة raw
        // قديمة تخصّ شهادة canonical سبق مسحها أعلاه يجب ألا تبقى، وإلا استُخدِمت خطأً لاحقاً.
        complianceCertRawEnc: null,
        complianceSecretEnc: null,
        complianceRequestId: null,
        complianceCsidEnvironment: null,
        productionCertEnc: null,
        productionCertRawEnc: null,
        productionSecretEnc: null,
        productionCsidEnvironment: null,
      },
    }),
  ]);

  return { csrPem };
}

/** يطلب شهادة الاختبار (Compliance CSID) من زاتكا فعلياً — يتطلب OTP يحصل عليه مسؤول الشركة من بوابة فاتورة الحقيقية. */
export async function requestCompanyComplianceCsid(tenantId: string, companyId: string, otp: string) {
  const company = await getCompanyOrThrow(tenantId, companyId);
  const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  if (!credential?.csrPem) throw badRequest("يجب توليد CSR أولاً قبل طلب شهادة الاختبار");

  const environment = company.zatcaEnvironment as ZatcaApiEnvironment;
  const result = await requestComplianceCsid(environment, Buffer.from(credential.csrPem).toString("base64"), otp);
  if (result.malformedResponse) {
    throw badRequest("رد غير متوقع من زاتكا — شكل الاستجابة لا يطابق شهادة اختبار صالحة، لم تُخزَّن أي بيانات. تحقق من إصدار/مسار API ثم أعد المحاولة، أو راجع الدعم الفني.");
  }
  if (!result.ok || !result.data) {
    throw badRequest(`رفضت زاتكا طلب شهادة الاختبار: ${result.data ? JSON.stringify(result.data) : "لا يوجد رد"}`);
  }
  const cert = normalizeZatcaCertificate(result.data.binarySecurityToken, "شهادة الاختبار (Compliance)");

  await prisma.$transaction([
    prisma.companyZatcaCredential.update({
      where: { companyId },
      data: {
        complianceCertEnc: encryptSecret(cert.canonical),
        complianceCertRawEnc: encryptSecret(cert.raw),
        complianceSecretEnc: encryptSecret(result.data.secret),
        complianceRequestId: String(result.data.requestID),
        lastMissingComplianceSteps: [],
        lastComplianceStepsCheckedAt: null,
        // البيئة الفعلية التي طُلبت منها هذه الشهادة تحديداً، لا بالضرورة ما ستصبح عليه
        // company.zatcaEnvironment لاحقاً — راجع تعليق الحقل في schema.prisma وcredentials.ts.
        complianceCsidEnvironment: environment,
      },
    }),
    prisma.company.update({ where: { id: companyId }, data: { zatcaOnboardingStatus: "compliance" } }),
  ]);

  return { requestId: String(result.data.requestID) };
}

/** يستبدل شهادة الاختبار بشهادة إنتاج فعلية — يتطلب أن تكون شهادة الاختبار مُستخرَجة بالفعل. */
export async function requestCompanyProductionCsid(tenantId: string, companyId: string) {
  const company = await getCompanyOrThrow(tenantId, companyId);
  const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  if (!credential?.complianceCertEnc || !credential.complianceSecretEnc || !credential.complianceRequestId) {
    throw badRequest("يجب استخراج شهادة الاختبار (Compliance) أولاً قبل طلب شهادة الإنتاج");
  }

  const environment = company.zatcaEnvironment as ZatcaApiEnvironment;
  // هذا الطلب نفسه Basic-auth بشهادة الاختبار (compliance) — يحتاج شكلها الخام للترويسة، لا القانوني
  // (راجع rawCertificateBodyBase64 في apiClient.ts وresolveZatcaRawCertificate في credentials.ts).
  const credentials = {
    certificateBodyBase64: decryptSecret(credential.complianceCertEnc),
    rawCertificateBodyBase64: resolveZatcaRawCertificate(credential.complianceCertRawEnc, credential.complianceCertEnc),
    secret: decryptSecret(credential.complianceSecretEnc),
  };

  // سطر سجلّ مميَّز عمداً — هذه أول لحظة تُطلَب فيها شهادة الإنتاج فعلياً لهذه الشركة، واللحظة
  // الوحيدة التي يمكن منها لاحقاً معرفة (بدليل، لا تخمين) هل تستمر سلسلة ICV/PIH بعد شهادة الإنتاج
  // أم تُعاد من الصفر — سؤال مفتوح صراحةً (راجع تعليق env.zatcaOnboardingDiagnostics). المقارنة
  // المطلوبة: ICV الفعلي لأول مستند إنتاج حقيقي لاحق مقابل zatcaNextIcv المُسجَّل هنا، وprevious
  // hash ذلك المستند مقابل zatcaLastInvoiceHash هنا.
  // eslint-disable-next-line no-console
  console.info(
    `[requestCompanyProductionCsid] طلب شهادة إنتاج — الشركة "${company.name}" (${companyId}) — ` +
      `حالة السلسلة قبل الطلب: zatcaNextIcv=${company.zatcaNextIcv} zatcaLastInvoiceHash=${company.zatcaLastInvoiceHash ?? "(لا يوجد بعد)"}`,
  );

  const result = await requestProductionCsid(
    environment,
    credentials,
    credential.complianceRequestId,
    // سقالة تشخيصية مؤقتة (راجع apiClient.ts) — فقط عند تفعيل العلَم، أثناء المشي اليدوي الحالي عبر
    // ربط زاتكا. تُزال لاحقاً.
    env.zatcaOnboardingDiagnostics ? { companyId, complianceRequestId: credential.complianceRequestId } : undefined,
  );
  if (result.networkError) {
    throw badRequest("انقطع الاتصال أثناء طلب شهادة الإنتاج؛ لم يصل تأكيد الإصدار ولم تُحفظ شهادة. قد يكون الطلب نُفّذ لدى زاتكا. احتفظ بالربط وراجع حالة الطلب قبل إعادة المحاولة أو إعادة الضبط.");
  }
  if (result.status === 401 || result.status === 403) {
    throw badRequest(`رفضت زاتكا المصادقة على طلب شهادة الإنتاج (HTTP ${result.status}). احتفظ بالربط الحالي؛ يلزم فحص صلاحية شهادة الاختبار وحالة طلب الإصدار، خصوصاً إذا سبق انقطاع الاتصال. نجاح اختبارات الامتثال لا يؤكد إصدار شهادة الإنتاج.`);
  }
  if (result.malformedResponse) {
    throw badRequest("وصل رد نجاح من زاتكا لكن بيانات شهادة الإنتاج غير مكتملة؛ لم تُحفظ شهادة. راجع حالة طلب الإصدار قبل إعادة المحاولة.");
  }
  if (!result.ok || !result.data) {
    // تسوية اختيارية فقط (راجع lastMissingComplianceSteps في schema.prisma وcomplianceAutomation.ts):
    // ZatcaComplianceStepAttempt المحلي هو مصدر التقدّم الأساسي دائماً — هذا فقط يلتقط رفض
    // Missing-ComplianceSteps الفعلي *عندما نصادفه* بلا استدعاء متعمَّد لاستفزازه. تساهلي عمداً
    // (بحث نصي على الجسم الخام كاملاً بصرف النظر عن مكان تداخل حقل message فيه) لأن الشكل الدقيق
    // لجسم هذا الرفض تحديداً لم يُتحقَّق منه مباشرة بعد — راجع التحذير في parseMissingComplianceSteps.
    const rawText = JSON.stringify(result.data ?? {});
    if (rawText.includes("Missing-ComplianceSteps")) {
      const remaining = parseMissingComplianceSteps(rawText);
      if (remaining.length) {
        await prisma.companyZatcaCredential.update({
          where: { companyId },
          data: { lastMissingComplianceSteps: remaining, lastComplianceStepsCheckedAt: new Date() },
        });
      }
    }
    throw badRequest(`تعذّر إصدار شهادة الإنتاج (HTTP ${result.status}): ${result.data ? JSON.stringify(result.data) : "وصل رد من زاتكا بلا تفاصيل قابلة للقراءة"}`);
  }
  const cert = normalizeZatcaCertificate(result.data.binarySecurityToken, "شهادة الإنتاج (Production)");

  await prisma.$transaction([
    prisma.companyZatcaCredential.update({
      where: { companyId },
      data: {
        productionCertEnc: encryptSecret(cert.canonical),
        productionCertRawEnc: encryptSecret(cert.raw),
        productionSecretEnc: encryptSecret(result.data.secret),
        productionCsidEnvironment: environment,
      },
    }),
    prisma.company.update({ where: { id: companyId }, data: { zatcaOnboardingStatus: "production" } }),
  ]);

  return { requestId: String(result.data.requestID) };
}

/**
 * تبديل البيئة الحالية (sandbox/simulation/production) — يُمنَع الانتقال لـ production بلا شهادة
 * إنتاج فعلية، ويُمنَع أيضاً أي تبديل طالما توجد شهادة فعّالة صادرة للبيئة الحالية بالذات: شهادة
 * زاتكا صادرة لبيئة معيّنة لا تعمل أبداً مع بيئة أخرى (عطل إنتاج فعلي مؤكَّد: شهادة اختبار حقيقية
 * صادرة بينما الشركة على sandbox — بوابة مطورين عامة ببيانات وهمية لا تعرف هذه الشهادة إطلاقاً —
 * فتغيير البيئة وحده، بلا إعادة إصدار الشهادة، يُبطلها فعلياً بصمت). المستخدم يجب أن يمرّ عمداً
 * بزر "إعادة ضبط الربط" (resetCompanyZatcaLinkage) أولاً، ثم يعيد استخراج الشهادة تحت البيئة
 * الجديدة — لا تبديل بنقرة واحدة يُسقِط ربطاً فعّالاً بصمت.
 */
export async function setCompanyZatcaEnvironment(tenantId: string, companyId: string, environment: ZatcaApiEnvironment) {
  const company = await getCompanyOrThrow(tenantId, companyId);
  if (environment === "production" && company.zatcaOnboardingStatus !== "production") {
    throw badRequest("لا يمكن التحويل لبيئة الإنتاج قبل استخراج شهادة إنتاج فعلية (Production CSID)");
  }

  if (environment !== company.zatcaEnvironment) {
    const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
    const usesComplianceNow = company.zatcaEnvironment !== "production";
    const hasLiveCredentialForCurrentEnvironment = usesComplianceNow
      ? Boolean(credential?.complianceCertEnc && credential?.complianceSecretEnc)
      : Boolean(credential?.productionCertEnc && credential?.productionSecretEnc);
    if (hasLiveCredentialForCurrentEnvironment) {
      throw badRequest(
        `لا يمكن تغيير بيئة زاتكا مباشرةً — توجد شهادة ربط فعّالة صادرة فعلياً لبيئة "${company.zatcaEnvironment}" الحالية. ` +
          `شهادة صادرة لبيئة معيّنة لا تعمل أبداً مع بيئة أخرى (سترفضها زاتكا بخطأ مصادقة 401). ` +
          `لتغيير البيئة: استخدم "إعادة ضبط الربط" أولاً لإبطال الربط الحالي عمداً، ثم أعد توليد CSR واستخراج الشهادة من جديد تحت البيئة الجديدة.`,
      );
    }
  }

  await prisma.company.update({ where: { id: companyId }, data: { zatcaEnvironment: environment } });
  return getZatcaStatus(tenantId, companyId);
}

/** يمسح كل شهادات/أسرار الربط الحالية ويعيد الشركة لحالة "غير مرتبطة" — لا يمسّ الفواتير المرحّلة سابقاً. */
export async function resetCompanyZatcaLinkage(tenantId: string, companyId: string) {
  await getCompanyOrThrow(tenantId, companyId);
  await prisma.$transaction([
    prisma.companyZatcaCredential.deleteMany({ where: { companyId } }),
    prisma.company.update({ where: { id: companyId }, data: { zatcaOnboardingStatus: "not_onboarded" } }),
  ]);
  return getZatcaStatus(tenantId, companyId);
}
