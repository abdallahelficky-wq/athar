import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "../../config/env";

// تشفير الأسرار الخاصة بربط زاتكا (المفتاح الخاص secp256k1، الشهادات، أسرار API) قبل تخزينها في
// CompanyZatcaCredential — لا يُخزَّن أي منها كنص خام أبداً. AES-256-GCM: تشفير مصادَق (authenticated)
// يكشف أي تلاعب بالنص المُشفَّر عند فك التشفير (فشل decipher.final() بدل إرجاع بيانات فاسدة بصمت).
//
// صيغة المغلّف (envelope) المُخزَّنة: "v1:<iv بترميز base64>:<tag بترميز base64>:<نص مشفّر بترميز base64>"
// — البادئة "v1" لإتاحة تبديل الخوارزمية/الصيغة لاحقاً دون كسر القيم المُخزَّنة القديمة.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENVELOPE_VERSION = "v1";

function getKey(): Buffer {
  if (!env.zatcaEncryptionKey) {
    throw new Error("متغير البيئة ZATCA_ENCRYPTION_KEY غير مضبوط — مطلوب لتشفير/فك تشفير أسرار ربط زاتكا");
  }
  const key = Buffer.from(env.zatcaEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("ZATCA_ENCRYPTION_KEY يجب أن يكون 32 بايت (256 بت) مُرمّزاً بـ base64");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(envelope: string): string {
  const key = getKey();
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("صيغة المغلّف المُشفَّر غير صالحة");
  }
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
