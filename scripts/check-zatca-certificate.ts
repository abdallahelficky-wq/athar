/**
 * سكربت قراءة فقط (read-only) — لا يعدّل أي بيانات، ولا يطبع أي شهادة أو مفتاح خاص أو أي بايتات
 * مفكوكة التشفير على الإطلاق تحت أي مسار تنفيذ، بما فيها الأخطاء غير المتوقَّعة. فقط: معرّف/اسم/
 * بيئة/حالة ربط الشركة (بيانات عادية غير سرّية أصلاً)، أطوال (lengths)، قيم منطقية (booleans)،
 * ونصوص أخطاء OpenSSL الثابتة (مثل "asn1 encoding routines::wrong tag") — لتشخيص هذا الخطأ الذي
 * يظهر فقط لاحقاً عند محاولة توقيع مستند فعلي، بلا الحاجة لإعادة إنتاجه يدوياً.
 *
 * لا يستورد src/config/env.ts أو src/lib/zatca/secretBox.ts عمداً (كلاهما يتطلّب متغيرات بيئة
 * غير متعلقة إطلاقاً بهذا التشخيص مثل JWT_ACCESS_SECRET) — بدلاً من ذلك يُعاد هنا فك التشفير
 * (AES-256-GCM، نفس صيغة المغلّف "v1:iv:tag:ciphertext" في secretBox.ts) مباشرة، معتمداً فقط على
 * DATABASE_URL وZATCA_ENCRYPTION_KEY.
 *
 * الاستخدام (مباشرة من Railway Console — القيمتان مضبوطتان هناك بالفعل كمتغيرات بيئة للخدمة):
 *
 *   npx tsx scripts/check-zatca-certificate.ts
 *     — بلا أي وسيط: يفحص كل شركة لديها أي سجل CompanyZatcaCredential على المنصّة كلها، ويطبع
 *       معرّفها واسمها مع نفس الفحوصات، سطراً مختصراً لكل شركة (لا يحتاج كتابة أي نص عربي في
 *       طرفية Railway، ولا معرفة معرّف شركة سلفاً).
 *
 *   npx tsx scripts/check-zatca-certificate.ts "<معرّف الشركة أو جزء من اسمها>"
 *     — نفس السلوك التفصيلي السابق لشركة واحدة بالضبط.
 *
 * محلياً (من جهاز لديه بيانات اتصال قاعدة بيانات الإنتاج، مثال PowerShell على Windows):
 *   $env:DATABASE_URL="postgresql://...neon.tech/..."
 *   $env:ZATCA_ENCRYPTION_KEY="<نفس القيمة المضبوطة في Railway>"
 *   npx tsx scripts/check-zatca-certificate.ts
 */
import { PrismaClient } from "@prisma/client";
import { createDecipheriv, X509Certificate, createPrivateKey } from "crypto";

const prisma = new PrismaClient();

function assertEncryptionKeyConfigured(): void {
  const keyB64 = process.env.ZATCA_ENCRYPTION_KEY;
  if (!keyB64) throw new Error("متغير البيئة ZATCA_ENCRYPTION_KEY غير مضبوط");
  if (Buffer.from(keyB64, "base64").length !== 32) throw new Error("ZATCA_ENCRYPTION_KEY يجب أن يكون 32 بايت مُرمّزاً بـ base64");
}

function decryptSecretStandalone(envelope: string): string {
  const key = Buffer.from(process.env.ZATCA_ENCRYPTION_KEY!, "base64");
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("صيغة المغلّف المُشفَّر غير صالحة");
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

function stripPemHeaders(pem: string, label: string): string {
  return pem.replace(`-----BEGIN ${label}-----`, "").replace(`-----END ${label}-----`, "").replace(/\r/g, "").trim();
}
function wrapPem(bodyOrFull: string, label: string): string {
  if (bodyOrFull.includes(`BEGIN ${label}`)) return bodyOrFull;
  return `-----BEGIN ${label}-----\n${bodyOrFull}\n-----END ${label}-----`;
}

function checkCertificate(raw: string) {
  const looksLikePemAlready = raw.includes("BEGIN CERTIFICATE");
  let parsesAsSingleEncoded = false;
  let parsesAfterOneExtraDecode = false;
  let parseErrorSingle = "";
  let parseErrorDouble = "";

  try {
    new X509Certificate(wrapPem(stripPemHeaders(raw, "CERTIFICATE"), "CERTIFICATE"));
    parsesAsSingleEncoded = true;
  } catch (e) {
    parseErrorSingle = e instanceof Error ? e.message : String(e);
  }

  try {
    const onceDecoded = Buffer.from(raw, "base64").toString("utf8");
    new X509Certificate(wrapPem(stripPemHeaders(onceDecoded, "CERTIFICATE"), "CERTIFICATE"));
    parsesAfterOneExtraDecode = true;
  } catch (e) {
    parseErrorDouble = e instanceof Error ? e.message : String(e);
  }

  return {
    length: raw.length,
    looksLikePemAlready,
    parsesAsSingleEncoded,
    parsesAfterOneExtraDecode,
    // أسماء أخطاء OpenSSL فقط (مثل "asn1 encoding routines::wrong tag") — لا أي جزء من المحتوى نفسه.
    parseErrorSingleEncodedAttempt: parseErrorSingle,
    parseErrorDoubleDecodeAttempt: parseErrorDouble,
  };
}

function checkPrivateKey(raw: string) {
  const looksLikePemAlready = raw.includes("BEGIN") && raw.includes("PRIVATE KEY");
  let parsesAsEcSec1 = false;
  let parseError = "";
  try {
    createPrivateKey(wrapPem(stripPemHeaders(raw, "EC PRIVATE KEY"), "EC PRIVATE KEY"));
    parsesAsEcSec1 = true;
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  return { length: raw.length, looksLikePemAlready, parsesAsEcSec1, parseError };
}

/** ملخّص سطر واحد لنتيجة checkCertificate — لعرض مضغوط في الوضع الجماعي (كل الشركات). */
function summarizeCertLine(label: string, certEnc: string | null): string {
  if (!certEnc) return `${label}: غير موجودة`;
  const result = checkCertificate(decryptSecretStandalone(certEnc));
  const status = result.parsesAsSingleEncoded
    ? "OK"
    : result.parsesAfterOneExtraDecode
      ? "OK-بعد-فك-ترميز-إضافي(!)" // إشارة قوية لترميز base64 مزدوج — راجع الفحص التفصيلي لهذه الشركة
      : `FAIL[${result.parseErrorSingleEncodedAttempt}]`;
  return `${label}: len=${result.length} pem=${result.looksLikePemAlready} parse=${status}`;
}

/** ملخّص سطر واحد لنتيجة checkPrivateKey — لعرض مضغوط في الوضع الجماعي. */
function summarizeKeyLine(privateKeyEnc: string | null): string {
  if (!privateKeyEnc) return "مفتاح خاص: غير موجود";
  const result = checkPrivateKey(decryptSecretStandalone(privateKeyEnc));
  const status = result.parsesAsEcSec1 ? "OK" : `FAIL[${result.parseError}]`;
  return `مفتاح خاص: len=${result.length} pem=${result.looksLikePemAlready} parse=${status}`;
}

/** الوضع الجماعي (بلا وسيط): كل شركة لديها أي سجل CompanyZatcaCredential — سطر مختصر واحد لكل بند. */
async function checkAllCompanies() {
  assertEncryptionKeyConfigured();

  const credentials = await prisma.companyZatcaCredential.findMany({
    select: { companyId: true, complianceCertEnc: true, productionCertEnc: true, privateKeyEnc: true },
  });
  if (!credentials.length) {
    console.log("لا توجد أي شركة لديها سجل CompanyZatcaCredential على الإطلاق.");
    return;
  }

  const companies = await prisma.company.findMany({
    where: { id: { in: credentials.map((c) => c.companyId) } },
    select: { id: true, name: true, zatcaEnvironment: true, zatcaOnboardingStatus: true },
  });
  const companyById = new Map(companies.map((c) => [c.id, c]));

  console.log(`[check-zatca-certificate.ts] فحص ${credentials.length} شركة لديها ربط زاتكا (بلا وسيط)\n`);

  for (const credential of credentials) {
    const company = companyById.get(credential.companyId);
    const header = company
      ? `[${company.id}] "${company.name}" env=${company.zatcaEnvironment} status=${company.zatcaOnboardingStatus}`
      : `[${credential.companyId}] (سجل شركة غير موجود؟)`;
    console.log(header);
    try {
      const usesCompliance = !company || company.zatcaEnvironment !== "production";
      const activeCertEnc = usesCompliance ? credential.complianceCertEnc : credential.productionCertEnc;
      const activeLabel = usesCompliance ? "compliance-cert" : "production-cert";
      console.log("  " + summarizeCertLine(activeLabel, activeCertEnc));
      console.log("  " + summarizeKeyLine(credential.privateKeyEnc));
    } catch (err) {
      // خطأ غير متوقَّع لشركة واحدة (مثال: مغلّف تشفير تالف) لا يجب أن يوقف فحص بقية الشركات —
      // رسالة الخطأ فقط (نص وصفي ثابت من Node/OpenSSL)، لا أي بيانات فعلية.
      console.log(`  خطأ أثناء فحص هذه الشركة: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** الوضع التفصيلي (بوسيط): معرّف دقيق أو جزء من اسم — سلوك مطابق تماماً لما كان عليه سابقاً. */
async function checkSingleCompany(query: string) {
  assertEncryptionKeyConfigured();
  console.log(`[check-zatca-certificate.ts] cwd=${process.cwd()} arg="${query}"`);

  const company =
    (await prisma.company.findUnique({ where: { id: query } })) ||
    (await prisma.company.findFirst({ where: { name: { contains: query, mode: "insensitive" } } }));

  if (!company) {
    console.log("لم توجد شركة مطابقة لهذا المعرّف أو الاسم.");
    return;
  }
  console.log(`الشركة: "${company.name}" (id=${company.id}) — بيئة زاتكا الحالية: ${company.zatcaEnvironment} — حالة الربط: ${company.zatcaOnboardingStatus}`);

  const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId: company.id } });
  if (!credential) {
    console.log("لا يوجد أي سجل CompanyZatcaCredential لهذه الشركة إطلاقاً (لم تبدأ ربط زاتكا بعد).");
    return;
  }

  const usesCompliance = company.zatcaEnvironment !== "production";
  const certEnc = usesCompliance ? credential.complianceCertEnc : credential.productionCertEnc;
  const certLabel = usesCompliance ? "شهادة الاختبار (Compliance)" : "شهادة الإنتاج (Production)";

  console.log(`\n--- ${certLabel} — هذه الشهادة تُستخدَم فعلياً للتوقيع حالياً بحسب بيئة الشركة ---`);
  if (!certEnc) {
    console.log("غير موجودة إطلاقاً في قاعدة البيانات.");
  } else {
    console.log(JSON.stringify(checkCertificate(decryptSecretStandalone(certEnc)), null, 2));
  }

  console.log("\n--- المفتاح الخاص (privateKeyEnc) — مشترك بين شهادتي الاختبار والإنتاج ---");
  if (!credential.privateKeyEnc) {
    console.log("غير موجود إطلاقاً في قاعدة البيانات.");
  } else {
    console.log(JSON.stringify(checkPrivateKey(decryptSecretStandalone(credential.privateKeyEnc)), null, 2));
  }

  // فحص الشهادة الأخرى أيضاً (غير المُستخدَمة حالياً) للمعلومة فقط — لا تأثير على القرار الحالي.
  const otherCertEnc = usesCompliance ? credential.productionCertEnc : credential.complianceCertEnc;
  const otherLabel = usesCompliance ? "شهادة الإنتاج (Production)" : "شهادة الاختبار (Compliance)";
  console.log(`\n--- ${otherLabel} — للمعلومة فقط، غير مُستخدَمة في بيئة الشركة الحالية ---`);
  if (!otherCertEnc) {
    console.log("غير موجودة.");
  } else {
    console.log(JSON.stringify(checkCertificate(decryptSecretStandalone(otherCertEnc)), null, 2));
  }
}

async function main() {
  const query = process.argv[2];
  if (query) await checkSingleCompany(query);
  else await checkAllCompanies();
}

main()
  .catch((err) => {
    console.error("خطأ أثناء التشخيص:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
