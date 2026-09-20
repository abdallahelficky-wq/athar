import { spawn } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { generateCsr, verifyCsrLocally } from "./csr";

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

const SAMPLE_PROPS = {
  environment: "sandbox" as const,
  egsModel: "v1",
  egsSerialNumber: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
  solutionName: "AtharAlMuhasabi",
  vatNumber: "300000000000003",
  branchLocation: "1234 طريق الملك فهد، الرياض",
  branchIndustry: "تجارة عامة",
  branchName: "الفرع الرئيسي",
  taxpayerName: "شركة أثر التجريبية",
  taxpayerProvidedId: "athar-test-001",
  invoiceType: "both" as const,
};

describe("generateCsr", () => {
  it("generates a secp256k1 private key and a CSR that OpenSSL itself considers structurally valid", async () => {
    const { privateKeyPem, csrPem } = await generateCsr(SAMPLE_PROPS);
    expect(privateKeyPem).toContain("-----BEGIN EC PRIVATE KEY-----");
    expect(csrPem).toContain("-----BEGIN CERTIFICATE REQUEST-----");
    expect(await verifyCsrLocally(csrPem)).toBe(true);
  });

  it.each([
    ["sandbox", "TSTZATCA-Code-Signing"],
    ["simulation", "PREZATCA-Code-Signing"],
    ["production", "ZATCA-Code-Signing"],
  ] as const)("encodes the %s template as ASN.1 PrintableString", async (environment, template) => {
    const { csrPem } = await generateCsr({ ...SAMPLE_PROPS, environment });
    const dir = await mkdtemp(path.join(tmpdir(), "zatca-csr-test-"));
    try {
      const csrFile = path.join(dir, "req.pem");
      await writeFile(csrFile, csrPem);
      const text = await run("openssl", ["req", "-in", csrFile, "-noout", "-text", "-nameopt", "utf8"]);
      expect(text).toContain(template);
      expect(text).toContain(SAMPLE_PROPS.taxpayerName);
      const asn1 = await run("openssl", ["asn1parse", "-in", csrFile]);
      const expectedDer = Buffer.concat([Buffer.from([0x13, template.length]), Buffer.from(template)]).toString("hex").toUpperCase();
      expect(asn1).toContain(expectedDer);
      expect(await verifyCsrLocally(csrPem)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("embeds the EGS serial number format (1-Solution|2-Model|3-Serial) and VAT number in the CSR's subjectAltName", async () => {
    const { csrPem } = await generateCsr(SAMPLE_PROPS);
    const dir = await mkdtemp(path.join(tmpdir(), "zatca-csr-test-"));
    try {
      const csrFile = path.join(dir, "req.pem");
      await writeFile(csrFile, csrPem);
      const text = await run("openssl", ["req", "-in", csrFile, "-noout", "-text"]);
      expect(text).toContain(`1-${SAMPLE_PROPS.solutionName}`);
      expect(text).toContain(`2-${SAMPLE_PROPS.egsModel}`);
      expect(text).toContain(SAMPLE_PROPS.egsSerialNumber);
      expect(text).toContain(SAMPLE_PROPS.vatNumber);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a garbage CSR as invalid", async () => {
    expect(await verifyCsrLocally("not a real csr")).toBe(false);
  });

  // عطل حقيقي مؤكَّد سابقاً: title كان مفروضاً "0100" (مبسّط فقط) دائماً بصرف النظر عن invoiceType —
  // شركة تُصدر فواتير قياسية B2B فعلياً كانت تحصل على شهادة لا تُخوِّل ذلك إطلاقاً.
  it.each([
    ["standard" as const, "1000"],
    ["simplified" as const, "0100"],
    ["both" as const, "1100"],
  ])("embeds title=%s for invoiceType=%s in the CSR", async (invoiceType, expectedTitle) => {
    const { csrPem } = await generateCsr({ ...SAMPLE_PROPS, invoiceType });
    const dir = await mkdtemp(path.join(tmpdir(), "zatca-csr-test-"));
    try {
      const csrFile = path.join(dir, "req.pem");
      await writeFile(csrFile, csrPem);
      const text = await run("openssl", ["req", "-in", csrFile, "-noout", "-text"]);
      expect(text).toContain(expectedTitle);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
