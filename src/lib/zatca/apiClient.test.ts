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

// إعادة إنتاج مباشرة للعطل الفعلي الذي وقع في الإنتاج: استجابة 2xx (نجاح HTTP) لكن بجسم لا يحمل
// binarySecurityToken/secret صالحين — قبل الإصلاح كان هذا يُقبَل كنجاح ويُخزَّن كشهادة حقيقية،
// فيفشل لاحقاً بخطأ ASN.1 غامض عند أول محاولة توقيع فعلية بها. كل حالة هنا يجب أن تُرفَض هنا
// وبوضوح، لا أن تمر بصمت.
describe("apiClient schema validation on 2xx responses (malformedResponse)", () => {
  it("rejects a 2xx compliance-CSID response with a completely empty body", async () => {
    mockFetchOnce(200, {});
    const result = await requestComplianceCsid("sandbox", "csr", "123456");
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBe(true);
    expect(result.data).toBeNull();
  });

  it("rejects a 2xx compliance-CSID response missing binarySecurityToken/secret", async () => {
    mockFetchOnce(200, { requestID: 1, dispositionMessage: "ISSUED" });
    const result = await requestComplianceCsid("sandbox", "csr", "123456");
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBe(true);
  });

  it("rejects a 2xx compliance-CSID response where binarySecurityToken is an empty string", async () => {
    mockFetchOnce(200, { requestID: 1, binarySecurityToken: "", secret: "s" });
    const result = await requestComplianceCsid("sandbox", "csr", "123456");
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBe(true);
  });

  it("rejects a 2xx production-CSID response missing the required fields", async () => {
    mockFetchOnce(200, { requestID: 2 });
    const result = await requestProductionCsid("simulation", CREDENTIALS, "compliance-req-123");
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBe(true);
  });

  it("accepts a well-formed 2xx compliance-CSID response", async () => {
    mockFetchOnce(200, { requestID: 1, binarySecurityToken: "cert-body", secret: "api-secret" });
    const result = await requestComplianceCsid("sandbox", "csr", "123456");
    expect(result.ok).toBe(true);
    expect(result.malformedResponse).toBeUndefined();
    expect(result.data).toEqual({ requestID: 1, binarySecurityToken: "cert-body", secret: "api-secret" });
  });

  it("rejects a 2xx clearance/reporting response that is a completely empty object", async () => {
    mockFetchOnce(200, {});
    const result = await clearInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBe(true);
  });

  it("rejects a 2xx clearance response carrying only an unrelated field", async () => {
    mockFetchOnce(200, { someUnexpectedField: "oops" });
    const result = await reportInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBe(true);
  });

  it("does not apply schema validation to a non-2xx (genuine rejection) response, even if its shape is unusual", async () => {
    mockFetchOnce(502, "<html>Bad Gateway</html>");
    const result = await clearInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBeUndefined();
  });
});
