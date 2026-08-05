// رمز الاستجابة السريعة (QR) بصيغة TLV/Base64 وفق زاتكا — المرحلة الثانية (تُضيف الوسوم 6-9 على
// الوسوم 1-5 الأصلية من src/lib/zatcaQr.ts، فقط للمستندات الموقّعة). التركيب: بايت الوسم (1-9) +
// بايت الطول (حتى 255) + القيمة الخام. الوسوم 1-5 نصوص UTF-8؛ 6-9 بايتات خام (تجزئة/توقيع/مفتاح
// عام/توقيع شهادة) — لا تُرمَّز إلى base64 نصاً قبل التضمين، بل تُفكّ من base64 إلى بايتات خام أولاً.

function tlvEntry(tag: number, value: Buffer): Buffer {
  if (value.length > 255) throw new Error(`قيمة الوسم ${tag} تتجاوز 255 بايت — الحد الأقصى لبنية TLV`);
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export interface ZatcaQrUnsignedParams {
  sellerName: string;
  sellerVat: string;
  isoTimestamp: string;
  invoiceTotal: number;
  vatTotal: number;
}

export interface ZatcaQrSignedParams extends ZatcaQrUnsignedParams {
  /** تجزئة المستند بترميز base64 (نفس invoiceHash) */
  invoiceHashBase64: string;
  /** التوقيع الرقمي بترميز base64 (نفس digitalSignature من signing.ts) */
  digitalSignatureBase64: string;
  /** SubjectPublicKeyInfo بترميز DER كاملاً (من certificateInfo.publicKeyRaw) — ليس نقطة المنحنى فقط */
  publicKeyRaw: Buffer;
  /** بايتات توقيع الشهادة الخام (من certificateInfo.signatureRaw) */
  certificateSignatureRaw: Buffer;
}

function unsignedTags(params: ZatcaQrUnsignedParams): Buffer[] {
  return [
    tlvEntry(1, Buffer.from(params.sellerName, "utf8")),
    tlvEntry(2, Buffer.from(params.sellerVat, "utf8")),
    tlvEntry(3, Buffer.from(params.isoTimestamp, "utf8")),
    tlvEntry(4, Buffer.from(params.invoiceTotal.toFixed(2), "utf8")),
    tlvEntry(5, Buffer.from(params.vatTotal.toFixed(2), "utf8")),
  ];
}

/** QR غير موقّع (الوسوم 1-5 فقط) — مطابق تماماً لـ buildZatcaQrPayload في src/lib/zatcaQr.ts */
export function buildUnsignedQrPayload(params: ZatcaQrUnsignedParams): string {
  return Buffer.concat(unsignedTags(params)).toString("base64");
}

/** QR كامل موقّع (الوسوم 1-9) — يُستخدَم فقط بعد نجاح التوقيع (signing.ts) */
export function buildSignedQrPayload(params: ZatcaQrSignedParams): string {
  const tags = [
    ...unsignedTags(params),
    tlvEntry(6, Buffer.from(params.invoiceHashBase64, "base64")),
    tlvEntry(7, Buffer.from(params.digitalSignatureBase64, "base64")),
    tlvEntry(8, params.publicKeyRaw),
    tlvEntry(9, params.certificateSignatureRaw),
  ];
  return Buffer.concat(tags).toString("base64");
}

export interface DecodedZatcaQr {
  sellerName: string;
  sellerVat: string;
  isoTimestamp: string;
  invoiceTotal: string;
  vatTotal: string;
  invoiceHash?: Buffer;
  digitalSignature?: Buffer;
  publicKey?: Buffer;
  certificateSignature?: Buffer;
}

/** يفكّ حمولة QR (TLV/base64) إلى حقولها التسعة — للتحقق واختبارات الجولة الكاملة (round-trip) فقط */
export function decodeQrPayload(payloadBase64: string): DecodedZatcaQr {
  const buf = Buffer.from(payloadBase64, "base64");
  const fields: Record<number, Buffer> = {};
  let offset = 0;
  while (offset < buf.length) {
    const tag = buf[offset];
    const length = buf[offset + 1];
    const value = buf.subarray(offset + 2, offset + 2 + length);
    fields[tag] = Buffer.from(value);
    offset += 2 + length;
  }
  return {
    sellerName: fields[1]?.toString("utf8") ?? "",
    sellerVat: fields[2]?.toString("utf8") ?? "",
    isoTimestamp: fields[3]?.toString("utf8") ?? "",
    invoiceTotal: fields[4]?.toString("utf8") ?? "",
    vatTotal: fields[5]?.toString("utf8") ?? "",
    invoiceHash: fields[6],
    digitalSignature: fields[7],
    publicKey: fields[8],
    certificateSignature: fields[9],
  };
}
