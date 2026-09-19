import { prisma } from "../prisma";
import { decryptSecret } from "./secretBox";
import { ZatcaApiEnvironment, ZatcaApiCredentials } from "./apiClient";

export interface ResolvedZatcaCredentials extends ZatcaApiCredentials {
  privateKeyPem: string;
}

export type LoadZatcaCredentialsResult =
  | { ok: true; credentials: ResolvedZatcaCredentials }
  /** لا شهادة CSID مناسبة لهذه البيئة بعد إطلاقاً — لا تزال الشركة في منتصف الربط (الحالة القديمة
   * التي كانت تُمثَّل بـ null قبل هذا التمييز) — تُعامَل كـ"بانتظار الاستخراج"، لا كخطأ. */
  | { ok: false; reason: "not_configured" }
  /** الشهادة موجودة فعلاً، لكنها صادرة من زاتكا لبيئة مختلفة عن البيئة المطلوبة الآن — إرسالها
   * مضمون الفشل بـ401 (تأكَّد فعلياً في الإنتاج: شهادة اختبار حقيقية صادرة بـOTP فعلي من بوابة
   * فاتورة، لكن بيئة الشركة كانت مضبوطة على sandbox — بوابة المطورين العامة ببيانات وهمية منفصلة
   * تماماً، لا تعرف هذه الشهادة إطلاقاً). لا تُعامَل كـ"بانتظار الاستخراج" (not_configured) ولا
   * يُحاوَل الإرسال بها إطلاقاً — تحتاج إعادة إصدار الشهادة تحت البيئة الصحيحة، لا إعادة محاولة. */
  | { ok: false; reason: "environment_mismatch"; issuedFor: ZatcaApiEnvironment };

/**
 * يفكّ تشفير الشكل الخام (raw) لشهادة CSID المخزَّن في العمود المنفصل rawEnc — يُستخدَم لترويسة
 * Basic Auth تحديداً (راجع rawCertificateBodyBase64 في apiClient.ts). صفوف قديمة سبقت إضافة هذا
 * العمود (rawEnc فارغ): يُستخدَم الشكل القانوني canonicalEnc بدلاً منه احتياطياً — هذا بالضبط
 * السلوك المعطوب الذي كان قائماً قبل هذا الفصل، فلا يُحسِّن ولا يُسوِّئ حال هذه الصفوف القديمة إلى
 * أن تُعاد معالجتها (إعادة إصدار CSID تكتب rawEnc من جديد تلقائياً — راجع companiesZatca.service.ts).
 *
 * تحذير متعمَّد: لا يوجد، ولن يُضاف، أي مسار لإعادة اشتقاق rawEnc الأصلي من canonicalEnc عبر إعادة
 * الترميز (base64 encode) لصفّ سبق تطبيعه — البايتات الوسيطة التي أُسقِطت وقت التطبيع غير معروفة
 * (قد تضمّنت رؤوس PEM/فراغات لا تُستعاد)، فأي "إعادة اشتقاق" هي تخمين لا إعادة بناء فعلية، قد ينجح
 * صدفة أو يفشل صامتاً لاحقاً في الإنتاج. التعافي الصحيح لصفّ متأثر: إعادة استخراج CSID من الصفر
 * (تُعيد كتابة rawEnc تلقائياً بالشكل الصحيح)، لا تخمين قيمته.
 */
export function resolveZatcaRawCertificate(rawEnc: string | null, canonicalEnc: string): string {
  return decryptSecret(rawEnc ?? canonicalEnc);
}

/**
 * يفكّ تشفير شهادة/سر API الفعليَين لشركة معيّنة، بحسب بيئتها الحالية (production يستخدم شهادة
 * الإنتاج، أي بيئة أخرى تستخدم شهادة الاختبار/Compliance) — بعد التحقق أولاً أن الشهادة المخزَّنة
 * صودرت فعلاً لهذه البيئة بالذات (راجع complianceCsidEnvironment/productionCsidEnvironment في
 * companiesZatca.service.ts، حيث تُسجَّل وقت الإصدار). لا يوجد أي احتياطي (fallback) بين البيئتين،
 * فشهادة اختبار لا تُستخدَم أبداً لإرسال حقيقي، والعكس.
 *
 * لصفوف قديمة سبقت إضافة هذا التسجيل (الحقل المُسجَّل فارغ/null): يُفتَرض تطابق البيئة الحالية —
 * لا إنذار كاذب لربط يعمل فعلاً اليوم، خطر ذلك يقتصر على صفّ واحد قديم مُحتمَل الخطأ فعلاً بالفعل
 * (وهو بالضبط ما دفع لإضافة هذا التسجيل)، لا يستحق تعطيل كل الشركات القائمة.
 */
export async function loadCompanyZatcaCredentials(
  companyId: string,
  environment: ZatcaApiEnvironment,
): Promise<LoadZatcaCredentialsResult> {
  const record = await prisma.companyZatcaCredential.findUnique({ where: { companyId } });
  if (!record || !record.privateKeyEnc) return { ok: false, reason: "not_configured" };

  const isProduction = environment === "production";
  const certEnc = isProduction ? record.productionCertEnc : record.complianceCertEnc;
  const rawCertEnc = isProduction ? record.productionCertRawEnc : record.complianceCertRawEnc;
  const secretEnc = isProduction ? record.productionSecretEnc : record.complianceSecretEnc;
  if (!certEnc || !secretEnc) return { ok: false, reason: "not_configured" };

  const issuedFor = isProduction ? record.productionCsidEnvironment : record.complianceCsidEnvironment;
  if (issuedFor && issuedFor !== environment) {
    return { ok: false, reason: "environment_mismatch", issuedFor: issuedFor as ZatcaApiEnvironment };
  }

  return {
    ok: true,
    credentials: {
      certificateBodyBase64: decryptSecret(certEnc),
      rawCertificateBodyBase64: resolveZatcaRawCertificate(rawCertEnc, certEnc),
      secret: decryptSecret(secretEnc),
      privateKeyPem: decryptSecret(record.privateKeyEnc),
    },
  };
}

/** رسالة موحَّدة لعرضها للمستخدم عند environment_mismatch — يستخدمها postingGate.ts وresubmit.ts معاً. */
export function zatcaEnvironmentMismatchMessage(issuedFor: ZatcaApiEnvironment, requested: ZatcaApiEnvironment): string {
  return (
    `شهادة ربط زاتكا الحالية لهذه الشركة صادرة لبيئة "${issuedFor}"، بينما الشركة مضبوطة الآن على بيئة "${requested}" — ` +
    `شهادة صادرة لبيئة معيّنة لا تعمل أبداً مع بيئة أخرى (سترفضها زاتكا بخطأ مصادقة 401 بلا أي علاقة بصحة الشهادة أو التوقيع). ` +
    `يجب إعادة ضبط ربط زاتكا لهذه الشركة ثم إعادة استخراج الشهادة (CSR ← Compliance ← Production) تحت بيئة "${requested}" قبل إعادة المحاولة.`
  );
}
