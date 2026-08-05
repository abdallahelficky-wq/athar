import { describe, expect, it } from "vitest";
import { buildSignedQrPayload, buildUnsignedQrPayload, decodeQrPayload } from "./qr";

const UNSIGNED_PARAMS = {
  sellerName: "شركة أثر التجريبية",
  sellerVat: "300000000000003",
  isoTimestamp: "2026-08-01T10:00:00Z",
  invoiceTotal: 115.0,
  vatTotal: 15.0,
};

describe("QR TLV encode/decode round-trip", () => {
  it("round-trips an unsigned (Phase 1, tags 1-5) payload exactly", () => {
    const payload = buildUnsignedQrPayload(UNSIGNED_PARAMS);
    const decoded = decodeQrPayload(payload);
    expect(decoded.sellerName).toBe(UNSIGNED_PARAMS.sellerName);
    expect(decoded.sellerVat).toBe(UNSIGNED_PARAMS.sellerVat);
    expect(decoded.isoTimestamp).toBe(UNSIGNED_PARAMS.isoTimestamp);
    expect(decoded.invoiceTotal).toBe("115.00");
    expect(decoded.vatTotal).toBe("15.00");
    expect(decoded.invoiceHash).toBeUndefined();
  });

  it("round-trips a fully signed (Phase 2, tags 1-9) payload exactly, including raw binary tags", () => {
    const invoiceHashBase64 = Buffer.from("sample-invoice-hash-bytes").toString("base64");
    const digitalSignatureBase64 = Buffer.from("sample-ecdsa-signature-bytes").toString("base64");
    const publicKeyRaw = Buffer.from([0x30, 0x56, 0x30, 0x10, 0x04, 0xab, 0xcd, 0xef]);
    const certificateSignatureRaw = Buffer.from([0x30, 0x46, 0x02, 0x21, 0x00, 0x11, 0x22, 0x33]);

    const payload = buildSignedQrPayload({
      ...UNSIGNED_PARAMS,
      invoiceHashBase64,
      digitalSignatureBase64,
      publicKeyRaw,
      certificateSignatureRaw,
    });
    const decoded = decodeQrPayload(payload);

    expect(decoded.sellerName).toBe(UNSIGNED_PARAMS.sellerName);
    expect(decoded.invoiceHash?.toString("base64")).toBe(invoiceHashBase64);
    expect(decoded.digitalSignature?.toString("base64")).toBe(digitalSignatureBase64);
    expect(decoded.publicKey?.equals(publicKeyRaw)).toBe(true);
    expect(decoded.certificateSignature?.equals(certificateSignatureRaw)).toBe(true);
  });

  it("rejects a value longer than 255 bytes (TLV length-byte limit)", () => {
    const tooLong = { ...UNSIGNED_PARAMS, sellerName: "a".repeat(256) };
    expect(() => buildUnsignedQrPayload(tooLong)).toThrow();
  });

  it("produces a payload consistent with the legacy Phase-1-only buildZatcaQrPayload for the same inputs", async () => {
    const { buildZatcaQrPayload } = await import("../zatcaQr");
    const legacy = buildZatcaQrPayload(
      UNSIGNED_PARAMS.sellerName,
      UNSIGNED_PARAMS.sellerVat,
      UNSIGNED_PARAMS.isoTimestamp,
      UNSIGNED_PARAMS.invoiceTotal,
      UNSIGNED_PARAMS.vatTotal,
    );
    const newImpl = buildUnsignedQrPayload(UNSIGNED_PARAMS);
    expect(newImpl).toBe(legacy);
  });
});
