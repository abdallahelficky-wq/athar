import { prisma } from "../prisma";
import { decryptSecret } from "./secretBox";
import { ZatcaApiEnvironment, ZatcaApiCredentials } from "./apiClient";

export interface ResolvedZatcaCredentials extends ZatcaApiCredentials {
  privateKeyPem: string;
}

/**
 * يفكّ تشفير شهادة/سر API الفعليَين لشركة معيّنة، بحسب بيئتها الحالية (production يستخدم شهادة
 * الإنتاج، أي بيئة أخرى تستخدم شهادة الاختبار/Compliance). يُرجع null إن لم تُستخرَج شهادة مناسبة
 * لهذه البيئة بعد — لا يوجد أي احتياطي (fallback) بين البيئتين، فشهادة اختبار لا تُستخدَم أبداً
 * لإرسال حقيقي، والعكس.
 */
export async function loadCompanyZatcaCredentials(
  companyId: string,
  environment: ZatcaApiEnvironment,
): Promise<ResolvedZatcaCredentials | null> {
  const record = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  if (!record || !record.privateKeyEnc) return null;

  const certEnc = environment === "production" ? record.productionCertEnc : record.complianceCertEnc;
  const secretEnc = environment === "production" ? record.productionSecretEnc : record.complianceSecretEnc;
  if (!certEnc || !secretEnc) return null;

  return {
    certificateBodyBase64: decryptSecret(certEnc),
    secret: decryptSecret(secretEnc),
    privateKeyPem: decryptSecret(record.privateKeyEnc),
  };
}
