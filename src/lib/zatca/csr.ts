import { spawn } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import buildCsrConfig, { CsrConfigProps } from "./templates/csrConfigTemplate";

// توليد مفتاح secp256k1 خاص + CSR (PKCS#10) عبر سطر أوامر OpenSSL — منطق مُقتبَس من
// `src/zatca/egs/index.ts` في wes4m/zatca-xml-js (رخصة MIT). لا توجد مكتبة JS أصلية تبني CSR
// موقّعاً (PKCS#10)؛ Node.js نفسه يدعم secp256k1 عبر crypto.createSign مباشرة (مُتحقَّق منه)، لكن
// لا يبني طلبات CSR — هذا هو السبب الوحيد للاعتماد على الأداة الخارجية OpenSSL هنا تحديداً.
//
// خلافاً للتطبيق المرجعي (الذي يكتب الملفات المؤقتة في /tmp مباشرة — عيب أمني موثَّق في تعليقاته
// هو نفسه)، هنا نستخدم مجلداً مؤقتاً عشوائياً حصرياً لهذه العملية (mkdtemp) بصلاحيات مقيَّدة على
// كل ملف (0o600)، ونحذفه فوراً بعد الانتهاء — المفتاح الخاص لا يُكتب لقاعدة البيانات إطلاقاً من
// هنا، بل يُمرَّر كنص للطبقة الأعلى التي تُشفِّره فوراً عبر secretBox.ts قبل أي تخزين.

function runOpenSsl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("openssl", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(new Error(`تعذّر تشغيل openssl: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`فشل أمر openssl ${args[0]} (رمز الخروج ${code}): ${stderr.trim()}`));
      else resolve(stdout);
    });
  });
}

async function generateSecp256k1PrivateKey(): Promise<string> {
  const result = await runOpenSsl(["ecparam", "-name", "secp256k1", "-genkey"]);
  if (!result.includes("-----BEGIN EC PRIVATE KEY-----")) {
    throw new Error("لم يُعثر على مفتاح خاص في مخرجات OpenSSL");
  }
  return `-----BEGIN EC PRIVATE KEY-----${result.split("-----BEGIN EC PRIVATE KEY-----")[1]}`.trim();
}

export interface GeneratedCsr {
  privateKeyPem: string;
  csrPem: string;
}

/** يولّد مفتاح secp256k1 خاص جديد + CSR موقّع به وفق حقول EGS المُعطاة. */
export async function generateCsr(props: CsrConfigProps): Promise<GeneratedCsr> {
  const privateKeyPem = await generateSecp256k1PrivateKey();
  const dir = await mkdtemp(path.join(tmpdir(), "zatca-csr-"));
  try {
    const keyFile = path.join(dir, "key.pem");
    const configFile = path.join(dir, "csr.cnf");
    await writeFile(keyFile, privateKeyPem, { mode: 0o600 });
    await writeFile(configFile, buildCsrConfig(props), { mode: 0o600 });

    const result = await runOpenSsl(["req", "-new", "-sha256", "-key", keyFile, "-config", configFile]);
    if (!result.includes("-----BEGIN CERTIFICATE REQUEST-----")) {
      throw new Error("لم يُعثر على طلب توقيع الشهادة (CSR) في مخرجات OpenSSL");
    }
    const csrPem = `-----BEGIN CERTIFICATE REQUEST-----${result.split("-----BEGIN CERTIFICATE REQUEST-----")[1]}`.trim();
    return { privateKeyPem, csrPem };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * يتحقق محلياً أن نص CSR صالح بنيوياً (PKCS#10) وموقّع صحيحاً — عبر openssl req -verify.
 * ملاحظة: openssl يكتب رسالة "verify OK" إلى stderr لا stdout، ويُنهي العملية برمز خروج 0 عند
 * النجاح فقط — فنجاح runOpenSsl (بلا استثناء) هو دليل التحقق الفعلي، بصرف النظر عن محتوى stdout.
 */
export async function verifyCsrLocally(csrPem: string): Promise<boolean> {
  const dir = await mkdtemp(path.join(tmpdir(), "zatca-csr-verify-"));
  try {
    const csrFile = path.join(dir, "req.pem");
    await writeFile(csrFile, csrPem, { mode: 0o600 });
    await runOpenSsl(["req", "-in", csrFile, "-verify", "-noout"]);
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
