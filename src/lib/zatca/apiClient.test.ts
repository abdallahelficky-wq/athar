import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkInvoiceCompliance,
  clearInvoice,
  extractRejectionReasons,
  reportInvoice,
  requestComplianceCsid,
  requestProductionCsid,
} from "./apiClient";

const CREDENTIALS = { certificateBodyBase64: "ZmFrZS1jZXJ0LWJvZHk=", secret: "fake-secret" };

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient request construction", () => {
  it("requestComplianceCsid posts to /compliance on the sandbox host with the OTP header and CSR body", async () => {
    const fetchMock = mockFetchOnce(200, { requestID: 1, binarySecurityToken: "cert", secret: "s" });
    await requestComplianceCsid("sandbox", "base64-csr-content", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance");
    expect(init.headers.OTP).toBe("123456");
    expect(JSON.parse(init.body)).toEqual({ csr: "base64-csr-content" });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("requestProductionCsid posts to /production/csids with Basic auth and the compliance request id", async () => {
    const fetchMock = mockFetchOnce(200, { requestID: 2, binarySecurityToken: "prod-cert", secret: "prod-secret" });
    await requestProductionCsid("simulation", CREDENTIALS, "compliance-req-123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/production/csids");
    expect(JSON.parse(init.body)).toEqual({ compliance_request_id: "compliance-req-123" });
    expect(init.headers.Authorization).toMatch(/^Basic /);
    // Basic auth is base64(base64(cert):secret) -- doubly-encoded per ZATCA's documented scheme
    const decoded = Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe(`${CREDENTIALS.certificateBodyBase64}:${CREDENTIALS.secret}`);
  });

  it("clearInvoice posts to /invoices/clearance/single with Clearance-Status: 1", async () => {
    const fetchMock = mockFetchOnce(200, { clearanceStatus: "CLEARED" });
    await clearInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "aW52b2ljZQ==", invoiceHash: "abc==", uuid: "u-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/clearance/single");
    expect(init.headers["Clearance-Status"]).toBe("1");
    expect(JSON.parse(init.body)).toEqual({ invoiceHash: "abc==", uuid: "u-1", invoice: "aW52b2ljZQ==" });
  });

  it("reportInvoice posts to /invoices/reporting/single with Clearance-Status: 0", async () => {
    const fetchMock = mockFetchOnce(200, { reportingStatus: "REPORTED" });
    await reportInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "aW52b2ljZQ==", invoiceHash: "abc==", uuid: "u-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/reporting/single");
    expect(init.headers["Clearance-Status"]).toBe("0");
  });

  it("checkInvoiceCompliance posts to /compliance/invoices", async () => {
    const fetchMock = mockFetchOnce(200, { validationResults: { status: "PASS" } });
    await checkInvoiceCompliance({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "aW52b2ljZQ==", invoiceHash: "abc==", uuid: "u-1" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance/invoices");
  });

  it("surfaces a non-2xx response as ok:false with the parsed error body intact", async () => {
    mockFetchOnce(400, {
      validationResults: { status: "FAIL", errorMessages: [{ type: "ERROR", message: "رقم ضريبي غير صالح" }] },
    });
    const result = await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(extractRejectionReasons(result.data)).toBe("رقم ضريبي غير صالح");
  });

  it("extractRejectionReasons falls back to a generic message when no error details are present", () => {
    expect(extractRejectionReasons(null)).toContain("بلا تفاصيل");
    expect(extractRejectionReasons({})).toContain("بلا تفاصيل");
  });
});
