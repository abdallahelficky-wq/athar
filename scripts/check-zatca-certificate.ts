/**
 * سكربت قراءة فقط (read-only) — لا يعدّل أي بيانات، ولا يطبع أي شهادة أو مفتاح خاص أو أي بايتات
 * مفكوكة التشفير على الإطلاق. فقط أطوال (lengths) وقيم منطقية (booleans) عن قابلية تحليل الشهادة/
 * المفتاح المخزَّنين لشركة معيّنة كـPKI صالح — لتشخيص خطأ "asn1 encoding routines::wrong tag"
 * الذي يظهر فقط لاحقاً عند محاولة توقيع مستند فعلي، بلا الحاجة لإعادة إنتاج ذلك الخطأ يدوياً.
 *
 * لا يستورد src/config/env.ts أو src/lib/zatca/secretBox.ts عمداً (كلاهما يتطلّب متغيرات بيئة
 * غير متعلقة إطلاقاً بهذا التشخيص مثل JWT_ACCESS_SECRET) — بدلاً من ذلك يُعاد هنا فك التشفير
 * (AES-256-GCM، نفس صيغة المغلّف "v1:iv:tag:ciphertext" في secretBox.ts) مباشرة، معتمداً فقط على
 * DATABASE_URL وZATCA_ENCRYPTION_KEY.
 *
 * الاستخدام (من الجهاز الذي لديه بيانات اتصال قاعدة بيانات الإنتاج، مثال PowerShell على Windows):
 *
 *   $env:DATABASE_URL="postgresql://...neon.tech/..."
 *   $env:ZATCA_ENCRYPTION_KEY="<نفس القيمة المضبوطة في Railway>"
 *   npx tsx scripts/check-zatca-certificate.ts "<معرّف الشركة أو جزء من اسمها>"
 *
 * أو في سطر واحد (bash/git-bash):
 *   DATABASE_URL="postgresql://..." ZATCA_ENCRYPTION_KEY="..." npx tsx scripts/check-zatca-certificate.ts "زاد الذهبية"
 *
 * القيمتان (DATABASE_URL وZATCA_ENCRYPTION_KEY) هما بالضبط ما هو مضبوط فعلياً في متغيرات بيئة
 * خدمة athar على Railway — انسخهما من هناك (Settings → Variables)، لا تُخزَّنا في أي ملف هنا.
 */
import { PrismaClient } from "@prisma/client";
import { createDecipheriv, X509Certificate, createPrivateKey } from "crypto";

const prisma = new PrismaClient();

function decryptSecretStandalone(envelope: string): string {
  const keyB64 = process.env.ZATCA_ENCRYPTION_KEY;
  if (!keyB64) throw new Error("متغير البيئة ZATCA_ENCRYPTION_KEY غير مضبوط");
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("ZATCA_ENCRYPTION_KEY يجب أن يكون 32 بايت مُرمّزاً بـ base64");

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

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('الاستخدام: npx tsx scripts/check-zatca-certificate.ts "معرّف الشركة أو جزء من اسمها"');
    process.exit(1);
  }

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

main()
  .catch((err) => {
    console.error("خطأ أثناء التشخيص:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
