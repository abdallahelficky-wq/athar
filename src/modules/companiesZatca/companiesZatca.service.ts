import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { encryptSecret, decryptSecret } from "../../lib/zatca/secretBox";
import { generateCsr, verifyCsrLocally } from "../../lib/zatca/csr";
import { requestComplianceCsid, requestProductionCsid, ZatcaApiEnvironment } from "../../lib/zatca/apiClient";

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
      update: { privateKeyEnc: encryptSecret(privateKeyPem), csrPem, complianceCertEnc: null, complianceSecretEnc: null, complianceRequestId: null, productionCertEnc: null, productionSecretEnc: null },
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

  await prisma.$transaction([
    prisma.companyZatcaCredential.update({
      where: { companyId },
      data: {
        complianceCertEnc: encryptSecret(result.data.binarySecurityToken),
        complianceSecretEnc: encryptSecret(result.data.secret),
        complianceRequestId: String(result.data.requestID),
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

  await prisma.$transaction([
    prisma.companyZatcaCredential.update({
      where: { companyId },
      data: {
        productionCertEnc: encryptSecret(result.data.binarySecurityToken),
        productionSecretEnc: encryptSecret(result.data.secret),
      },
    }),
    prisma.company.update({ where: { id: companyId }, data: { zatcaOnboardingStatus: "production" } }),
  ]);

  return { requestId: String(result.data.requestID) };
}

/** تبديل البيئة الحالية (sandbox/simulation/production) — يُمنَع الانتقال لـ production بلا شهادة إنتاج فعلية. */
export async function setCompanyZatcaEnvironment(tenantId: string, companyId: string, environment: ZatcaApiEnvironment) {
  const company = await getCompanyOrThrow(tenantId, companyId);
  if (environment === "production" && company.zatcaOnboardingStatus !== "production") {
    throw badRequest("لا يمكن التحويل لبيئة الإنتاج قبل استخراج شهادة إنتاج فعلية (Production CSID)");
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
