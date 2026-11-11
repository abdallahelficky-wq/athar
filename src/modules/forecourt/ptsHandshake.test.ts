import { describe, expect, it } from "vitest";
import { matchPtsHandshakeSignature, ptsHandshakeHeadersForLog, ptsHandshakeSignedTexts, ptsSignature, verifyPtsHandshakeSignature } from "./ptsHandshake";

/**
 * توقيع مصافحة WebSocket من PTS-2 — بمثال الوثيقة نفسها (R140 ص305، المفتاح "PTS-2"): المصافحة مُدخَل خارجي يرسله الجهاز
 * (CLAUDE.md القاعدة 2). الحالات الأخرى هي نفس المصافحة الموثقة بعد تعديل متعمَّد يحاكي ما تفعله طبقة وسيطة (Cloudflare/Railway):
 * إضافة ترويسات قبل التوقيع وتصغير أسماء الترويسات — يجب أن يبقى التوقيع صحيحاً، وأي تغيير في قيمة موقَّعة يُفشله.
 */
const REQUEST_LINE = "GET /jsonPtsWebsockets HTTP/1.1";
const DOC_HEADERS = [
  "Host", "192.168.1.185:45456",
  "Authorization", "Basic YWRtaW46YWRtaW4=",
  "Origin", "https://192.168.1.118:443",
  "Upgrade", "websocket",
  "Connection", "Upgrade",
  "Sec-WebSocket-Key", "uQAAALQAAAA6AAAATwAAAA==",
  "X-Pts-Id", "801800043137511835363934",
  "X-Pts-Firmware-Version-DateTime", "2026-08-15T17:14:15",
  "X-Pts-Configuration-Identifier", "da86bd9f",
  "X-Pts-Protocol-Revision-Number", "140",
  "Sec-WebSocket-Version", "13",
  "X-DateTime", "2026-08-15T17:16:44",
  "X-Data-Signature", "4tWUO2r4lOh5YFOVpt1hTHxNKXeLFIBUI/2EPqOmHdU=",
];

describe("PTS-2 WebSocket handshake signature", () => {
  it("verifies the specification's own signed handshake (secret \"PTS-2\", p.305)", () => {
    expect(verifyPtsHandshakeSignature("PTS-2", REQUEST_LINE, DOC_HEADERS)).toBe(true);
    expect(verifyPtsHandshakeSignature("other-key", REQUEST_LINE, DOC_HEADERS)).toBe(false);
  });

  it("signs the request line and every header before the signature, each ending in CRLF", () => {
    const signed = ptsHandshakeSignedTexts(REQUEST_LINE, DOC_HEADERS)!;
    expect(signed.texts[0].startsWith("GET /jsonPtsWebsockets HTTP/1.1\r\nHost: 192.168.1.185:45456\r\n")).toBe(true);
    expect(signed.texts[0].endsWith("X-DateTime: 2026-08-15T17:16:44\r\n")).toBe(true);
  });

  it("still verifies after a proxy inserts headers and lower-cases names (deliberate edit of the documented handshake)", () => {
    const viaProxy: string[] = [];
    for (let i = 0; i < DOC_HEADERS.length; i += 2) {
      if (DOC_HEADERS[i] === "Upgrade") viaProxy.push("x-forwarded-for", "10.0.0.1", "cf-ray", "8a1b2c3d4e5f-JED");
      viaProxy.push(DOC_HEADERS[i].toLowerCase(), DOC_HEADERS[i + 1]);
    }
    expect(verifyPtsHandshakeSignature("PTS-2", REQUEST_LINE, viaProxy)).toBe(true);
  });

  it("rejects a changed signed value, a changed path, and a handshake without a signature", () => {
    const tampered = [...DOC_HEADERS];
    tampered[tampered.indexOf("X-Pts-Id") + 1] = "801800043137511835363935";
    expect(verifyPtsHandshakeSignature("PTS-2", REQUEST_LINE, tampered)).toBe(false);
    expect(verifyPtsHandshakeSignature("PTS-2", "GET /other HTTP/1.1", DOC_HEADERS)).toBe(false);
    expect(verifyPtsHandshakeSignature("PTS-2", REQUEST_LINE, DOC_HEADERS.slice(0, -2))).toBe(false);
  });

  it("verifies when Cloudflare drops the default port from Host (deliberate edit of the documented handshake)", () => {
    // الجهاز يوقّع Host بمنفذه كما في مثال الوثيقة؛ نوقّع المصافحة الموثقة بعد جعل Host = "pts.atharerp.com:443" بنفس الخوارزمية
    // التي تحقّقنا منها بمتجه الوثيقة أعلاه، ثم نسلّمها كما يمرّرها Cloudflare (Host بلا منفذ). لا يوجد متجه من الجهاز لهذه الحالة.
    const signedHeaders = DOC_HEADERS.slice(0, -2);
    signedHeaders[1] = "pts.atharerp.com:443";
    const signedText = `${REQUEST_LINE}\r\n${Array.from({ length: signedHeaders.length / 2 }, (_, i) => `${signedHeaders[2 * i]}: ${signedHeaders[2 * i + 1]}\r\n`).join("")}`;
    const signature = ptsSignature("PTS-2", Buffer.from(signedText, "utf8"));
    const delivered = [...signedHeaders, "X-Data-Signature", signature];
    delivered[1] = "pts.atharerp.com";
    expect(matchPtsHandshakeSignature("PTS-2", REQUEST_LINE, delivered)).toBe("as_received_host_port");
    expect(matchPtsHandshakeSignature("other-key", REQUEST_LINE, delivered)).toBeNull();
    expect(matchPtsHandshakeSignature("PTS-2", REQUEST_LINE, DOC_HEADERS)).toBe("as_received");
  });

  it("redacts the Authorization value when headers are logged", () => {
    const logged = ptsHandshakeHeadersForLog(DOC_HEADERS);
    expect(logged).toContain("Authorization: [redacted]");
    expect(logged.join("\n")).not.toContain("YWRtaW46YWRtaW4=");
    expect(logged).toContain("X-Pts-Id: 801800043137511835363934");
  });
});
