import { spawn } from "child_process";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createHash, createVerify, X509Certificate } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDocumentXml } from "./xmlBuilder";
import { computeDocumentHash } from "./hash";
import { signDocument, getCertificateInfo } from "./signing";
import { ZATCA_FIRST_INVOICE_PIH, ZatcaDocumentInput } from "./types";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
  });
}

let workDir: string;
let privateKeyPem: string;
let certificatePem: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "zatca-signing-test-"));
  const keyFile = path.join(workDir, "key.pem");
  const certFile = path.join(workDir, "cert.pem");
  await run("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", keyFile]);
  await run("openssl", ["req", "-x509", "-key", keyFile, "-sha256", "-days", "1", "-subj", "/CN=zatca-test", "-out", certFile]);
  privateKeyPem = await readFile(keyFile, "utf8");
  certificatePem = await readFile(certFile, "utf8");
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function sampleDocument(): ZatcaDocumentInput {
  return {
    kind: "invoice",
    subtype: "simplified",
    id: "INV-00001",
    uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
    issueDate: "2026-08-01",
    issueTime: "10:00:00",
    icv: 1,
    previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH,
    seller: {
      vatNumber: "300000000000003",
      crNumber: "1010101010",
      registrationName: "شركة أثر التجريبية",
      street: "طريق الملك فهد",
      buildingNumber: "1234",
      citySubdivision: "العليا",
      city: "الرياض",
      postalZone: "12345",
    },
    lines: [
      { id: "1", name: "خدمة استشارية", quantity: 1, unitPrice: 100, lineSubtotal: 100, lineVat: 15, taxCategoryCode: "S", taxPercent: 15 },
    ],
  };
}

describe("signDocument", () => {
  it("can reproduce the SignedProperties digest from the actual emitted block", () => {
    const { signedXml } = signDocument({ xml: buildDocumentXml(sampleDocument()), certificatePem, privateKeyPem });
    const properties = signedXml.match(/<xades:SignedProperties\b[\s\S]*?<\/xades:SignedProperties>/)![0];
    // Isolated hashing representation described by ZATCA signing support:
    // retain text/whitespace, declare ds locally, use an empty DigestMethod.
    const isolated = properties
      .replace(/<ds:(DigestMethod|DigestValue|X509IssuerName|X509SerialNumber)([ >])/g,
        '<ds:$1 xmlns:ds="http://www.w3.org/2000/09/xmldsig#"$2')
      .replace(/(<ds:DigestMethod[^>]+)><\/ds:DigestMethod>/, "$1/>");
    const expected = Buffer.from(createHash("sha256").update(isolated).digest("hex")).toString("base64");
    const reference = signedXml.match(/URI="#xadesSignedProperties"[\s\S]*?<ds:DigestValue>([^<]+)/)![1];
    expect(reference).toBe(expected);
  });
  it("computes the same invoice hash as computeDocumentHash on the unsigned XML", () => {
    const xml = buildDocumentXml(sampleDocument());
    const expectedHash = computeDocumentHash(xml);
    const { invoiceHash } = signDocument({ xml, certificatePem, privateKeyPem });
    expect(invoiceHash).toBe(expectedHash);
  });

  it("produces a digital signature that cryptographically verifies against the certificate's public key", () => {
    const xml = buildDocumentXml(sampleDocument());
    const { invoiceHash, digitalSignature } = signDocument({ xml, certificatePem, privateKeyPem });

    const x509 = new X509Certificate(certificatePem);
    const verifier = createVerify("sha256");
    verifier.update(Buffer.from(invoiceHash, "base64"));
    const isValid = verifier.verify(x509.publicKey, Buffer.from(digitalSignature, "base64"));
    expect(isValid).toBe(true);
  });

  it("rejects a signature verification against a tampered hash (negative control)", () => {
    const xml = buildDocumentXml(sampleDocument());
    const { digitalSignature } = signDocument({ xml, certificatePem, privateKeyPem });

    const x509 = new X509Certificate(certificatePem);
    const verifier = createVerify("sha256");
    verifier.update(Buffer.from("a-different-hash-entirely", "utf8"));
    const isValid = verifier.verify(x509.publicKey, Buffer.from(digitalSignature, "base64"));
    expect(isValid).toBe(false);
  });

  it("embeds the certificate, digital signature, and signed properties into the UBLExtensions block", () => {
    const xml = buildDocumentXml(sampleDocument());
    const { signedXml, digitalSignature, certificateInfo } = signDocument({ xml, certificatePem, privateKeyPem });

    expect(signedXml).toContain("<ds:SignatureValue>" + digitalSignature + "</ds:SignatureValue>");
    expect(signedXml).toContain("<xades:SignedProperties");
    expect(signedXml).toContain(certificateInfo.serialNumber);
    expect(signedXml).not.toBe(xml);
  });

  it("extracts the DER-encoded SubjectPublicKeyInfo from the certificate (matches ZATCA QR tag 8 exactly as the reference implementation uses it)", () => {
    const xml = buildDocumentXml(sampleDocument());
    const { certificateInfo } = signDocument({ xml, certificatePem, privateKeyPem });
    // SEQUENCE tag (0x30) wrapping AlgorithmIdentifier + BIT STRING — not the bare 65-byte point.
    expect(certificateInfo.publicKeyRaw[0]).toBe(0x30);
    // البيتات الأخيرة تحمل نقطة المنحنى الخام غير المضغوطة (0x04 || X || Y، 65 بايت)
    const rawPoint = certificateInfo.publicKeyRaw.subarray(certificateInfo.publicKeyRaw.length - 65);
    expect(rawPoint[0]).toBe(0x04);
  });

  // حالة حقيقية مُؤكَّدة فعلياً على الإنتاج: زاتكا أعادت binarySecurityToken لشركة فعلية مُرمَّزاً
  // base64 مرتين. getCertificateInfo يجب أن يتسامح مع هذا تلقائياً، ويُعيد canonicalBodyBase64
  // مطابقاً للجسم الصحيح بعد فك الترميز الإضافي — لا الجسم المزدوج الترميز كما وصل.
  describe("getCertificateInfo tolerates double-base64-encoded certificates", () => {
    it("parses a double-encoded certificate body and reports the correctly-decoded canonical form", () => {
      const certificateBodyBase64 = certificatePem.replace("-----BEGIN CERTIFICATE-----", "").replace("-----END CERTIFICATE-----", "").replace(/\r?\n/g, "");
      const doubleEncoded = Buffer.from(certificateBodyBase64, "utf8").toString("base64");

      const info = getCertificateInfo(doubleEncoded);

      expect(info.canonicalBodyBase64).toBe(certificateBodyBase64);
      expect(info.serialNumber).toBe(getCertificateInfo(certificateBodyBase64).serialNumber);
    });

    it("embeds the correctly-decoded certificate body in the signed XML, not the double-encoded input", () => {
      const xml = buildDocumentXml(sampleDocument());
      const certificateBodyBase64 = certificatePem.replace("-----BEGIN CERTIFICATE-----", "").replace("-----END CERTIFICATE-----", "").replace(/\r?\n/g, "");
      const doubleEncoded = Buffer.from(certificateBodyBase64, "utf8").toString("base64");

      const { signedXml } = signDocument({ xml, certificatePem: doubleEncoded, privateKeyPem });

      expect(signedXml).toContain(certificateBodyBase64);
      expect(signedXml).not.toContain(doubleEncoded);
    });

    it("still throws the original (single-encoded) parse error when the certificate is genuinely unparseable, not a double-encoding artifact", () => {
      expect(() => getCertificateInfo("this-is-not-a-valid-certificate-at-all")).toThrow(/asn1|PEM|base64/i);
    });
  });
});
