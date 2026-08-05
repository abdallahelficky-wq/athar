import { spawn } from "child_process";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDocumentXml } from "./xmlBuilder";
import { signAndSubmitDocument } from "./submission";
import { decodeQrPayload } from "./qr";
import { ZATCA_FIRST_INVOICE_PIH, ZatcaDocumentInput } from "./types";
import { ResolvedZatcaCredentials } from "./credentials";

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
let credentials: ResolvedZatcaCredentials;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "zatca-submission-test-"));
  const keyFile = path.join(workDir, "key.pem");
  const certFile = path.join(workDir, "cert.pem");
  await run("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", keyFile]);
  await run("openssl", ["req", "-x509", "-key", keyFile, "-sha256", "-days", "1", "-subj", "/CN=zatca-test", "-out", certFile]);
  const privateKeyPem = await readFile(keyFile, "utf8");
  const certificatePem = await readFile(certFile, "utf8");
  const certificateBodyBase64 = certificatePem.replace("-----BEGIN CERTIFICATE-----", "").replace("-----END CERTIFICATE-----", "").replace(/\r?\n/g, "");
  credentials = { certificateBodyBase64, secret: "fake-api-secret", privateKeyPem };
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    seller: { vatNumber: "300000000000003", registrationName: "شركة أثر التجريبية" },
    lines: [{ id: "1", name: "خدمة", quantity: 1, unitPrice: 100, lineSubtotal: 100, lineVat: 15, taxCategoryCode: "S", taxPercent: 15 }],
  };
}

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }),
  );
}

describe("signAndSubmitDocument", () => {
  it("signs the document, submits it, and returns accepted:true with a full signed QR payload on success", async () => {
    mockFetchOnce(200, { reportingStatus: "REPORTED" });
    const xml = buildDocumentXml(sampleDocument());

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials,
      kind: "reporting",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) throw new Error("expected accepted outcome");
    const decoded = decodeQrPayload(outcome.qrPayload);
    expect(decoded.sellerName).toBe("شركة أثر التجريبية");
    expect(decoded.invoiceHash).toBeDefined();
    expect(decoded.digitalSignature).toBeDefined();
    expect(decoded.publicKey).toBeDefined();
    expect(decoded.certificateSignature).toBeDefined();
  });

  it("returns accepted:false with a human-readable rejection reason when ZATCA rejects the submission", async () => {
    mockFetchOnce(400, {
      validationResults: { status: "FAIL", errorMessages: [{ type: "ERROR", message: "الرقم الضريبي للبائع غير صحيح" }] },
    });
    const xml = buildDocumentXml(sampleDocument());

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials,
      kind: "clearance",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) throw new Error("expected rejected outcome");
    expect(outcome.reason).toContain("الرقم الضريبي للبائع غير صحيح");
    expect(outcome.signedXml).toContain("<ds:SignatureValue>");
  });

  it("computes the same invoice hash whether the submission is accepted or rejected (hash is independent of the API outcome)", async () => {
    const xml = buildDocumentXml(sampleDocument());
    const baseParams = {
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox" as const,
      credentials,
      qrBaseParams: { sellerName: "s", sellerVat: "v", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    };

    mockFetchOnce(200, {});
    const accepted = await signAndSubmitDocument({ ...baseParams, kind: "reporting" });
    vi.unstubAllGlobals();
    mockFetchOnce(400, {});
    const rejected = await signAndSubmitDocument({ ...baseParams, kind: "reporting" });

    expect(accepted.invoiceHash).toBe(rejected.invoiceHash);
  });
});
