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
 * ترتيب وصولها وبأسمائها الموثقة (إن أضافت طبقة وسيطة ترويسات أو صغّرت الأسماء)، (3) نفس ما سبق بـHost يحمل المنفذ ":443": مثال
 * الوثيقة يرسل Host بمنفذه (ص305)، وCloudflare يحذف المنفذ الافتراضي من Host قبل تمرير الطلب، فيتغيّر النص الموقَّع.
 * null إن لم تكن في الطلب ترويسة توقيع.
 */
export function ptsHandshakeSignedTexts(requestLine: string, rawHeaders: string[]): { signature: string; texts: string[]; labels: string[] } | null {
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
  const deviceOnly = pairs.filter(([n]) => DEVICE_HEADER_CASE.has(n.toLowerCase())).map(([n, v]): [string, string] => [DEVICE_HEADER_CASE.get(n.toLowerCase())!, v]);
  const withHostPort = (list: [string, string][]) =>
    list.map(([n, v]): [string, string] => (n.toLowerCase() === "host" && !v.includes(":") ? [n, `${v}:443`] : [n, v]));
  const candidates: [string, [string, string][]][] = [
    ["as_received", pairs],
    ["device_headers", deviceOnly],
    ["as_received_host_port", withHostPort(pairs)],
    ["device_headers_host_port", withHostPort(deviceOnly)],
  ];
  const texts: string[] = [];
  const labels: string[] = [];
  for (const [label, list] of candidates) {
    const t = text(list);
    if (texts.includes(t)) continue;
    texts.push(t);
    labels.push(label);
  }
  return { signature, texts, labels };
}

/** اسم النص المرشّح الذي طابق التوقيع، أو null إن لم يطابق أي نص. */
export function matchPtsHandshakeSignature(secret: string, requestLine: string, rawHeaders: string[]): string | null {
  const signed = ptsHandshakeSignedTexts(requestLine, rawHeaders);
  if (!signed) return null;
  const i = signed.texts.findIndex((t) => signaturesMatch(ptsSignature(secret, Buffer.from(t, "utf8")), signed.signature));
  return i >= 0 ? signed.labels[i] : null;
}

export function verifyPtsHandshakeSignature(secret: string, requestLine: string, rawHeaders: string[]): boolean {
  return matchPtsHandshakeSignature(secret, requestLine, rawHeaders) !== null;
}

/** الترويسات كما وصلت، للتشخيص في السجل — قيمة Authorization (فيها كلمة مرور مستخدم الجهاز) تُحجب. */
export function ptsHandshakeHeadersForLog(rawHeaders: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    out.push(`${rawHeaders[i]}: ${rawHeaders[i].toLowerCase() === "authorization" ? "[redacted]" : rawHeaders[i + 1]}`);
  }
  return out;
}
