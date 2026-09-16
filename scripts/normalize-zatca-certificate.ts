/**
 * سكربت علاجي لمرّة واحدة (one-off remediation) — يُطبِّع شهادة زاتكا مخزَّنة فعلياً لشركة معيّنة
 * إن كانت مُرمَّزة base64 مرتين (حالة حقيقية مُؤكَّدة فعلياً في الإنتاج، راجع
 * scripts/check-zatca-certificate.ts والتقرير المرتبط) — بلا أي حاجة لإعادة استخراج الشهادة من
 * زاتكا (CSID) نفسها، لأن الشهادة صحيحة فعلياً، فقط تحتاج تطبيع الشكل المخزَّن.
 *
 * Dry-run افتراضياً — لا يكتب أي شيء لقاعدة البيانات إطلاقاً إلا إذا مُرِّر --write صراحةً.
 *
 * الخطوات (لكل حقل شهادة موجود: complianceCertEnc وproductionCertEnc، كلاهما إن وُجدا):
 *   1. يفكّ تشفير الشهادة المخزَّنة حالياً.
 *   2. يتحقق أنها تُحلَّل فعلاً كشهادة X.509 صالحة — إما كما هي (فلا حاجة لأي تغيير)، أو بعد فك
 *      ترميز base64 إضافي واحد (هذه هي الحالة القابلة للإصلاح تلقائياً).
 *   3. في وضع --write فقط: يُعيد تشفير الشكل القانوني (canonical) الناتج ويُحدِّث الصف في القاعدة.
 *   4. في وضع --write فقط: يُعيد قراءة الصف المُحدَّث وفكّ تشفيره من جديد، ويتحقق أنه أصبح يُحلَّل
 *      *مباشرة* الآن (بلا حاجة لأي فك ترميز إضافي) — تأكيد فعلي أن التطبيع نجح، لا افتراضاً.
 *
 * لا يمسّ المفتاح الخاص (privateKeyEnc) إطلاقاً — لا حاجة لذلك، والتشخيص أكّد أنه سليم بالفعل.
 *
 * نفس ضمان الأمان في scripts/check-zatca-certificate.ts بالضبط: لا يُطبَع أي محتوى شهادة أو مفتاح
 * أو أي بايتات مفكوكة التشفير مطلقاً تحت أي مسار تنفيذ، بما فيها الأخطاء غير المتوقَّعة — فقط
 * معرّف/اسم/بيئة/حالة الشركة، أطوال، قيم منطقية، وأسماء أخطاء OpenSSL الثابتة.
 *
 * الاستخدام (من Railway Console، حيث DATABASE_URL وZATCA_ENCRYPTION_KEY مضبوطتان فعلياً):
 *
 *   npx tsx scripts/normalize-zatca-certificate.ts <معرّف الشركة الدقيق>
 *     — فحص فقط (dry-run)، بلا أي كتابة، يطبع ما كان سيُفعَل بالضبط.
 *
 *   npx tsx scripts/normalize-zatca-certificate.ts <معرّف الشركة الدقيق> --write
 *     — يُطبِّع فعلياً ويكتب للقاعدة، ثم يتحقق من النتيجة.
 *
 * يتطلَّب معرّف شركة دقيقاً فقط (لا بحثاً جزئياً بالاسم كالسكربت التشخيصي) — عملية كتابة على شركة
 * واحدة يجب ألا تعتمد على تطابق غامض قد يصيب شركة أخرى بالخطأ.
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { getCertificateInfo } from "../src/lib/zatca/signing";

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

/** مطابق تماماً لصيغة المغلّف في src/lib/zatca/secretBox.ts (v1:iv:tag:ciphertext، AES-256-GCM) —
 * أي قيمة تُكتَب هنا يجب أن يقدر التطبيق الفعلي فك تشفيرها لاحقاً بلا أي فرق. */
function encryptSecretStandalone(plaintext: string): string {
  const key = Buffer.from(process.env.ZATCA_ENCRYPTION_KEY!, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

type CertField = "complianceCertEnc" | "productionCertEnc";

async function normalizeField(companyId: string, field: CertField, encryptedValue: string, write: boolean) {
  const raw = decryptSecretStandalone(encryptedValue);

  let info;
  try {
    info = getCertificateInfo(raw);
  } catch (err) {
    console.log(`  ${field}: len=${raw.length} — لا تُحلَّل حتى بعد محاولة فك ترميز إضافي — الخطأ: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  ${field}: لا يمكن إصلاحها تلقائياً — تحتاج إعادة استخراج شهادة (CSID) فعلية من زاتكا`);
    return;
  }

  const alreadyCanonical = raw.trim() === info.canonicalBodyBase64;
  if (alreadyCanonical) {
    console.log(`  ${field}: len=${raw.length} — تُحلَّل مباشرة بالفعل (مفرد الترميز) — لا حاجة لأي تغيير`);
    return;
  }

  console.log(`  ${field}: len=${raw.length} — مُرمَّزة base64 مرتين، الشكل القانوني بعد فك الترميز الإضافي len=${info.canonicalBodyBase64.length}`);
  if (!write) {
    console.log(`  ${field}: [dry-run] كان سيُعاد تشفير الشكل القانوني وتحديث هذا الحقل — لم تُكتَب أي بيانات (مرِّر --write للتنفيذ الفعلي)`);
    return;
  }

  const canonicalEnc = encryptSecretStandalone(info.canonicalBodyBase64);
  await prisma.companyZatcaCredential.update({ where: { companyId }, data: { [field]: canonicalEnc } });
  console.log(`  ${field}: [write] تم تحديث الحقل بالشكل القانوني`);

  // تحقّق فعلي بعد الكتابة، لا افتراض — أعِد القراءة وفكّ التشفير من جديد، وتأكَّد أنها تُحلَّل
  // *مباشرة* الآن بلا حاجة لأي فك ترميز إضافي.
  const reloaded = await prisma.companyZatcaCredential.findUniqueOrThrow({ where: { companyId } });
  const rewrittenEnc = reloaded[field];
  if (!rewrittenEnc) {
    console.log(`  ${field}: [تحقّق] فشل — الحقل فارغ بعد الكتابة، هذا غير متوقَّع إطلاقاً`);
    return;
  }
  const rewrittenRaw = decryptSecretStandalone(rewrittenEnc);
  let verifyInfo;
  try {
    verifyInfo = getCertificateInfo(rewrittenRaw);
  } catch (err) {
    console.log(`  ${field}: [تحقّق] فشل — لا تُحلَّل حتى بعد الكتابة! الخطأ: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const nowCanonicalOnFirstTry = rewrittenRaw.trim() === verifyInfo.canonicalBodyBase64;
  console.log(`  ${field}: [تحقّق] len=${rewrittenRaw.length} — تُحلَّل مباشرة الآن بلا فك ترميز إضافي: ${nowCanonicalOnFirstTry ? "نعم ✓" : "لا ✗"}`);
}

async function main() {
  const companyId = process.argv[2];
  const write = process.argv.includes("--write");
  if (!companyId) {
    console.error("الاستخدام: npx tsx scripts/normalize-zatca-certificate.ts <معرّف الشركة الدقيق> [--write]");
    process.exit(1);
  }

  assertEncryptionKeyConfigured();
  console.log(`[normalize-zatca-certificate.ts] companyId="${companyId}" mode=${write ? "WRITE" : "dry-run (لا كتابة)"}`);

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    console.log("لا توجد شركة بهذا المعرّف الدقيق.");
    return;
  }
  console.log(`الشركة: "${company.name}" env=${company.zatcaEnvironment} status=${company.zatcaOnboardingStatus}`);

  const credential = await prisma.companyZatcaCredential.findUnique({ where: { companyId: company.id } });
  if (!credential) {
    console.log("لا يوجد أي سجل CompanyZatcaCredential لهذه الشركة.");
    return;
  }

  if (!credential.complianceCertEnc && !credential.productionCertEnc) {
    console.log("لا توجد أي شهادة (compliance أو production) مخزَّنة لهذه الشركة إطلاقاً.");
    return;
  }

  if (credential.complianceCertEnc) await normalizeField(company.id, "complianceCertEnc", credential.complianceCertEnc, write);
  if (credential.productionCertEnc) await normalizeField(company.id, "productionCertEnc", credential.productionCertEnc, write);

  if (!write) console.log("\n[dry-run] لم تُكتَب أي بيانات. أعد التشغيل بإضافة --write للتنفيذ الفعلي بعد مراجعة ما سبق.");
}

main()
  .catch((err) => {
    console.error("خطأ أثناء التطبيع:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
