import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { encryptSecret, decryptSecret } from "../../lib/zatca/secretBox";
import { generateCsr, verifyCsrLocally } from "../../lib/zatca/csr";
import { requestComplianceCsid, requestProductionCsid, ZatcaApiEnvironment } from "../../lib/zatca/apiClient";
import { getCertificateInfo } from "../../lib/zatca/signing";

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

/**
 * يتحقق أن binarySecurityToken الذي أعادته زاتكا فعلياً قابل للتحليل كشهادة X.509 صالحة *قبل*
 * تخزينه، ويُعيد الشكل القانوني (canonical) الذي يجب تخزينه فعلياً — لا القيمة الخام كما وصلت
 * بالضرورة. getCertificateInfo (signing.ts) يتسامح تلقائياً مع ترميز base64 مزدوج (حالة حقيقية
 * مُؤكَّدة فعلياً من شركة على الإنتاج — راجع scripts/check-zatca-certificate.ts وتقرير التشخيص
 * المرتبط)، فيُعيد canonicalBodyBase64 مطابقاً لما نجح تحليله فعلياً كـX.509 صالح، بصرف النظر عن
 * الشكل الأصلي كما وصل. لا نطبِّق أي فك ترميز أعمى هنا — الشكل القانوني مُستخرَج فقط من محاولة
 * تحليل فعلية ناجحة، لا تخمين.
 *
 * نُسجِّل أيّ شكل اكتُشِف فعلياً (مفرد أو مزدوج) — لم نُثبِت بعد أيّهما "المعيار" الفعلي لدى زاتكا
 * (قد يختلف بين بيئات، أو يكون غير ثابت حتى لدى زاتكا نفسها)، فهذا السجلّ هو مصدر المعرفة
 * التراكمية حول ذلك مع كل شركة جديدة تُربَط، لا افتراضاً مسبقاً.
 */
function normalizeZatcaCertificate(binarySecurityToken: string, csidLabel: string): string {
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
  const detectedForm = binarySecurityToken.trim() === info.canonicalBodyBase64 ? "مفرد (كما وصلت من زاتكا)" : "مزدوج (احتاجت فك ترميز base64 إضافي)";
  // eslint-disable-next-line no-console
  console.info(`[normalizeZatcaCertificate] ${csidLabel}: شكل ترميز الشهادة المكتشَف من زاتكا = ${detectedForm}`);
  return info.canonicalBodyBase64;
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
    hasComplianceCertificate: Boolean(credential?.complianceCertEnc),
    hasProductionCertificate: Boolean(credential?.productionCertEnc),
  };
}

export interface GenerateCsrInput {
  production: boolean;
  solutionName?: string;
  model?: string;
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

  const { privateKeyPem, csrPem } = await generateCsr({
    production: input.production,
    solutionName,
    egsModel: model,
    egsSerialNumber: egsUuid,
    vatNumber: company.vatNumber,
    branchLocation,
    branchIndustry,
    branchName: company.shortName || company.name,
    taxpayerName: company.name,
    taxpayerProvidedId: company.crNumber,
  });

  const csrValid = await verifyCsrLocally(csrPem);
  if (!csrValid) throw badRequest("فشل التحقق المحلي من طلب توقيع الشهادة (CSR) المُولَّد — حاول مرة أخرى");

  await prisma.$transaction([
    prisma.company.update({ where: { id: companyId }, data: { zatcaSolutionName: solutionName, zatcaModel: model, zatcaEgsUuid: egsUuid } }),
    prisma.companyZatcaCredential.upsert({
      where: { companyId },
      create: { companyId, privateKeyEnc: encryptSecret(privateKeyPem), csrPem },
      update: {
        privateKeyEnc: encryptSecret(privateKeyPem),
        csrPem,
        complianceCertEnc: null,
        complianceSecretEnc: null,
        complianceRequestId: null,
        complianceCsidEnvironment: null,
        productionCertEnc: null,
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
  const canonicalCert = normalizeZatcaCertificate(result.data.binarySecurityToken, "شهادة الاختبار (Compliance)");

  await prisma.$transaction([
    prisma.companyZatcaCredential.update({
      where: { companyId },
      data: {
        complianceCertEnc: encryptSecret(canonicalCert),
        complianceSecretEnc: encryptSecret(result.data.secret),
        complianceRequestId: String(result.data.requestID),
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
  const credentials = { certificateBodyBase64: decryptSecret(credential.complianceCertEnc), secret: decryptSecret(credential.complianceSecretEnc) };
  const result = await requestProductionCsid(environment, credentials, credential.complianceRequestId);
  if (result.malformedResponse) {
    throw badRequest("رد غير متوقع من زاتكا — شكل الاستجابة لا يطابق شهادة إنتاج صالحة، لم تُخزَّن أي بيانات. تحقق من إصدار/مسار API ثم أعد المحاولة، أو راجع الدعم الفني.");
  }
  if (!result.ok || !result.data) {
    throw badRequest(`رفضت زاتكا طلب شهادة الإنتاج: ${result.data ? JSON.stringify(result.data) : "لا يوجد رد"}`);
  }
  const canonicalCert = normalizeZatcaCertificate(result.data.binarySecurityToken, "شهادة الإنتاج (Production)");

  await prisma.$transaction([
    prisma.companyZatcaCredential.update({
      where: { companyId },
      data: {
        productionCertEnc: encryptSecret(canonicalCert),
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
