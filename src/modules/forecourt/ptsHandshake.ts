import { createHmac, timingSafeEqual } from "crypto";

/**
 * توقيع jsonPTS — دوال نقية بلا قاعدة بيانات (تُختبر بمتجهات الوثيقة مباشرة). طلبات HTTP يُوقَّع جسمها الخام (ptsSignature)، ومصافحة
 * WebSocket يُوقَّع سطر طلبها وترويساتها حتى ترويسة التوقيع (verifyPtsHandshakeSignature، R140 ص305).
 */

/** Base64(HMAC-SHA256(المفتاح، البايتات كما هي)) */
export const ptsSignature = (secret: string, payload: Buffer) => createHmac("sha256", secret).update(payload).digest("base64");

export function signaturesMatch(expected: string, received: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(received.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** أسماء ترويسات الجهاز كما في مثال الوثيقة — لإعادة بناء النص الموقَّع إن غيّرت طبقة وسيطة حالة الأحرف */
const DEVICE_HEADER_NAMES = [
  "Host", "Authorization", "Origin", "Upgrade", "Connection", "Sec-WebSocket-Key", "X-Pts-Id", "X-Pts-Firmware-Version-DateTime",
  "X-Pts-Configuration-Identifier", "X-Pts-Protocol-Revision-Number", "Sec-WebSocket-Version", "X-DateTime",
];
const DEVICE_HEADER_CASE = new Map(DEVICE_HEADER_NAMES.map((n) => [n.toLowerCase(), n]));

/**
 * النصوص المرشّحة التي وقّعها الجهاز: (1) سطر الطلب والترويسات كما وصلت حتى ترويسة التوقيع، (2) ترويسات الجهاز الموثقة فقط بنفس
 * ترتيب وصولها وبأسمائها الموثقة (إن أضافت طبقة وسيطة ترويسات أو صغّرت الأسماء). null إن لم تكن في الطلب ترويسة توقيع.
 */
export function ptsHandshakeSignedTexts(requestLine: string, rawHeaders: string[]): { signature: string; texts: string[] } | null {
  const pairs: [string, string][] = [];
  let signature: string | null = null;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === "x-data-signature") {
      signature = rawHeaders[i + 1];
      break;
    }
    pairs.push([rawHeaders[i], rawHeaders[i + 1]]);
  }
  if (!signature) return null;
  const text = (list: [string, string][]) => `${requestLine}\r\n${list.map(([n, v]) => `${n}: ${v}\r\n`).join("")}`;
  const asReceived = text(pairs);
  const deviceOnly = text(pairs.filter(([n]) => DEVICE_HEADER_CASE.has(n.toLowerCase())).map(([n, v]) => [DEVICE_HEADER_CASE.get(n.toLowerCase())!, v]));
  return { signature, texts: asReceived === deviceOnly ? [asReceived] : [asReceived, deviceOnly] };
}

export function verifyPtsHandshakeSignature(secret: string, requestLine: string, rawHeaders: string[]): boolean {
  const signed = ptsHandshakeSignedTexts(requestLine, rawHeaders);
  if (!signed) return false;
  return signed.texts.some((t) => signaturesMatch(ptsSignature(secret, Buffer.from(t, "utf8")), signed.signature));
}
