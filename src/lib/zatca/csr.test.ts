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
  production: false,
  egsModel: "v1",
  egsSerialNumber: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
  solutionName: "AtharAlMuhasabi",
  vatNumber: "300000000000003",
  branchLocation: "1234 طريق الملك فهد، الرياض",
  branchIndustry: "تجارة عامة",
  branchName: "الفرع الرئيسي",
  taxpayerName: "شركة أثر التجريبية",
  taxpayerProvidedId: "athar-test-001",
};

describe("generateCsr", () => {
  it("generates a secp256k1 private key and a CSR that OpenSSL itself considers structurally valid", async () => {
    const { privateKeyPem, csrPem } = await generateCsr(SAMPLE_PROPS);
    expect(privateKeyPem).toContain("-----BEGIN EC PRIVATE KEY-----");
    expect(csrPem).toContain("-----BEGIN CERTIFICATE REQUEST-----");
    expect(await verifyCsrLocally(csrPem)).toBe(true);
  });

  it("embeds the compliance (test) template OID value, not production, when production=false", async () => {
    const { csrPem } = await generateCsr({ ...SAMPLE_PROPS, production: false });
    const dir = await mkdtemp(path.join(tmpdir(), "zatca-csr-test-"));
    try {
      const csrFile = path.join(dir, "req.pem");
      await writeFile(csrFile, csrPem);
      const text = await run("openssl", ["req", "-in", csrFile, "-noout", "-text"]);
      expect(text).toContain("TSTZATCA-Code-Signing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("embeds the production template OID value when production=true", async () => {
    const { csrPem } = await generateCsr({ ...SAMPLE_PROPS, production: true });
    const dir = await mkdtemp(path.join(tmpdir(), "zatca-csr-test-"));
    try {
      const csrFile = path.join(dir, "req.pem");
      await writeFile(csrFile, csrPem);
      const text = await run("openssl", ["req", "-in", csrFile, "-noout", "-text"]);
      expect(text).toContain("ZATCA-Code-Signing");
      expect(text).not.toContain("TSTZATCA-Code-Signing");
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
});
