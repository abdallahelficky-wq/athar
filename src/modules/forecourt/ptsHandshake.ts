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
 * النصوص المرشّحة التي وقّعها الجهاز. الجهاز يوقّع سطر الطلب وترويساته بترتيبه هو حتى ترويسة التوقيع، لكن ما يصل للخادم قد تغيّره
 * الطبقات الوسيطة (Cloudflare ثم حافة Railway): رأينا في الإنتاج (جهاز مكة، firmware 2026-11-08) الترويسات مرتّبة أبجدياً، وأسماءها
 * بحالة أحرف مختلفة (X-Datetime، Sec-Websocket-Key)، وترويسات مضافة (Cf-*، X-Forwarded-*)، وHost بلا المنفذ الافتراضي.
 * لذلك يُجرَّب: (1) النص كما وصل حتى التوقيع، (2) ترويسات الجهاز الموثقة فقط بترتيب الوصول، (3) ترويسات الجهاز الموثقة مُعادٌ
 * ترتيبها بترتيب الوثيقة (ص305) وبأسمائها الموثقة — ولكلٍّ منها نسخة بـHost يحمل ":443" ونسخة بلا Authorization. كلها تتطلب HMAC
 * بمفتاح المتحكم نفسه، فتعدد المرشّحين لا يُضعف التحقق. null إن لم تكن في الطلب ترويسة توقيع.
 */
export function ptsHandshakeSignedTexts(requestLine: string, rawHeaders: string[]): { signature: string; texts: string[]; labels: string[] } | null {
  const before: [string, string][] = [];
  const all: [string, string][] = [];
  let signature: string | null = null;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === "x-data-signature") {
      if (signature === null) signature = rawHeaders[i + 1];
      continue;
    }
    if (signature === null) before.push([rawHeaders[i], rawHeaders[i + 1]]);
    all.push([rawHeaders[i], rawHeaders[i + 1]]);
  }
  if (!signature) return null;
  const text = (list: [string, string][]) => `${requestLine}\r\n${list.map(([n, v]) => `${n}: ${v}\r\n`).join("")}`;
  const canonicalName = ([n, v]: [string, string]): [string, string] => [DEVICE_HEADER_CASE.get(n.toLowerCase())!, v];
  const deviceInArrival = before.filter(([n]) => DEVICE_HEADER_CASE.has(n.toLowerCase())).map(canonicalName);
  const deviceInDocOrder = all
    .filter(([n]) => DEVICE_HEADER_CASE.has(n.toLowerCase()))
    .map(canonicalName)
    .sort((a, b) => DEVICE_HEADER_NAMES.indexOf(a[0]) - DEVICE_HEADER_NAMES.indexOf(b[0]));
  const withHostPort = (list: [string, string][]) =>
    list.map(([n, v]): [string, string] => (n.toLowerCase() === "host" && !v.includes(":") ? [n, `${v}:443`] : [n, v]));
  const withoutAuth = (list: [string, string][]) => list.filter(([n]) => n.toLowerCase() !== "authorization");
  const candidates: [string, [string, string][]][] = [
    ["as_received", before],
    ["device_headers", deviceInArrival],
    ["as_received_host_port", withHostPort(before)],
    ["device_headers_host_port", withHostPort(deviceInArrival)],
    ["doc_order", deviceInDocOrder],
    ["doc_order_host_port", withHostPort(deviceInDocOrder)],
    ["doc_order_no_auth", withoutAuth(deviceInDocOrder)],
    ["doc_order_host_port_no_auth", withoutAuth(withHostPort(deviceInDocOrder))],
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
