import { spawn } from "child_process";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resubmitZatcaDocument } from "./resubmit";
import { rebuildZatcaDocumentXml } from "./chain";
import * as credentialsModule from "./credentials";

vi.mock("./credentials", () => ({ loadCompanyZatcaCredentials: vi.fn() }));

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
let credentials: { certificateBodyBase64: string; secret: string; privateKeyPem: string };

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "zatca-resubmit-test-"));
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

const COMPANY = {
  id: "company-1",
  zatcaOnboardingStatus: "production",
  zatcaEnvironment: "sandbox",
  zatcaLastInvoiceHash: null,
  name: "شركة أثر التجريبية",
  vatNumber: "300000000000003",
  crNumber: "1010101010",
  addressStreet: "طريق الملك فهد",
  addressBuilding: "1234",
  addressDistrict: "العليا",
  addressCity: "الرياض",
  addressPostalCode: "12345",
};

const SIMPLIFIED_CUSTOMER = {
  customerType: "individual",
  vatNumber: null,
  crNumber: null,
  name: "عميل نقدي",
  street: null,
  buildingNo: null,
  district: null,
  city: null,
  postalCode: null,
};

const LINES = [
  { description: "خدمة", quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, taxCategoryCode: "S", taxExemptionReason: null },
];

const ISSUED_AT = new Date("2026-08-01T10:00:00.000Z");
const DOCUMENT_UUID = "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockReset();
});

describe("resubmitZatcaDocument", () => {
  it("rebuilds byte-identical XML deterministically from the persisted chain fields (same hash every time)", () => {
    const first = rebuildZatcaDocumentXml({
      company: COMPANY, customer: SIMPLIFIED_CUSTOMER, kind: "invoice",
      documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
      icv: 5, previousInvoiceHash: "abc123", issuedAt: ISSUED_AT,
    });
    const second = rebuildZatcaDocumentXml({
      company: COMPANY, customer: SIMPLIFIED_CUSTOMER, kind: "invoice",
      documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
      icv: 5, previousInvoiceHash: "abc123", issuedAt: ISSUED_AT,
    });
    expect(second.xml).toBe(first.xml);
    expect(second.invoiceHash).toBe(first.invoiceHash);
  });

  it("refuses to resubmit when the recomputed hash no longer matches the originally stored invoiceHash", async () => {
    await expect(
      resubmitZatcaDocument({
        company: COMPANY, customer: SIMPLIFIED_CUSTOMER,
        documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
        grandTotal: 115, vatTotal: 15,
        icv: 5, previousInvoiceHash: "abc123", invoiceHash: "a-hash-that-will-never-match",
        issuedAt: ISSUED_AT,
      }),
    ).rejects.toThrow(/لا تطابق النسخة الأصلية/);
    expect(vi.mocked(credentialsModule.loadCompanyZatcaCredentials)).not.toHaveBeenCalled();
  });

  it("fails clearly when the company has no active ZATCA credentials to resubmit with", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(null);
    const rebuilt = rebuildZatcaDocumentXml({
      company: COMPANY, customer: SIMPLIFIED_CUSTOMER, kind: "invoice",
      documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
      icv: 5, previousInvoiceHash: "abc123", issuedAt: ISSUED_AT,
    });

    await expect(
      resubmitZatcaDocument({
        company: COMPANY, customer: SIMPLIFIED_CUSTOMER,
        documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
        grandTotal: 115, vatTotal: 15,
        icv: 5, previousInvoiceHash: "abc123", invoiceHash: rebuilt.invoiceHash,
        issuedAt: ISSUED_AT,
      }),
    ).rejects.toThrow(/لا توجد شهادة ربط زاتكا فعالة/);
  });

  it("marks the document reported when the retried submission is accepted this time", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    mockFetchOnce(200, { reportingStatus: "REPORTED" });
    const rebuilt = rebuildZatcaDocumentXml({
      company: COMPANY, customer: SIMPLIFIED_CUSTOMER, kind: "invoice",
      documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
      icv: 5, previousInvoiceHash: "abc123", issuedAt: ISSUED_AT,
    });

    const result = await resubmitZatcaDocument({
      company: COMPANY, customer: SIMPLIFIED_CUSTOMER,
      documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
      grandTotal: 115, vatTotal: 15,
      icv: 5, previousInvoiceHash: "abc123", invoiceHash: rebuilt.invoiceHash,
      issuedAt: ISSUED_AT,
    });

    expect(result.zatcaStatus).toBe("reported");
    expect(result.zatcaClearedOrReportedAt).toBeInstanceOf(Date);
  });

  it("keeps the document rejected with the new reason when ZATCA rejects the retry again", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    mockFetchOnce(400, { validationResults: { errorMessages: [{ type: "ERROR", message: "لا يزال هناك خطأ في التنسيق" }] } });
    const rebuilt = rebuildZatcaDocumentXml({
      company: COMPANY, customer: SIMPLIFIED_CUSTOMER, kind: "invoice",
      documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
      icv: 5, previousInvoiceHash: "abc123", issuedAt: ISSUED_AT,
    });

    const result = await resubmitZatcaDocument({
      company: COMPANY, customer: SIMPLIFIED_CUSTOMER,
      documentNumber: "INV-00001", documentUuid: DOCUMENT_UUID, lines: LINES as never,
      grandTotal: 115, vatTotal: 15,
      icv: 5, previousInvoiceHash: "abc123", invoiceHash: rebuilt.invoiceHash,
      issuedAt: ISSUED_AT,
    });

    expect(result.zatcaStatus).toBe("rejected");
    expect(result.rejectionReason).toContain("لا يزال هناك خطأ في التنسيق");
  });
});
