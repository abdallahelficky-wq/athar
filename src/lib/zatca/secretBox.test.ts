import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secretBox";

describe("zatca secretBox", () => {
  it("round-trips a plaintext secret through encrypt/decrypt", () => {
    const plaintext = "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIA...\n-----END EC PRIVATE KEY-----";
    const envelope = encryptSecret(plaintext);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(envelope).not.toContain(plaintext);
    expect(decryptSecret(envelope)).toBe(plaintext);
  });

  it("produces a different envelope each time (random IV) for the same plaintext", () => {
    const plaintext = "same-secret-value";
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("rejects a tampered ciphertext", () => {
    const envelope = encryptSecret("سر حساس بالعربية أيضاً");
    const [version, iv, tag, ciphertext] = envelope.split(":");
    const tamperedByte = Buffer.from(ciphertext, "base64");
    tamperedByte[0] = tamperedByte[0] ^ 0xff;
    const tampered = [version, iv, tag, tamperedByte.toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
