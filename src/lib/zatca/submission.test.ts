import { spawn } from "child_process";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDocumentXml } from "./xmlBuilder";
import { resolveZatcaSubmissionKind, signAndSubmitDocument } from "./submission";
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

function mockFetchOnce(status: number, body: unknown, statusText = "") {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => bodyText,
    headers: { forEach: (_cb: (value: string, key: string) => void) => undefined },
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

  it("surfaces a clear, distinct reason when ZATCA answers 2xx with a body that doesn't match the expected shape", async () => {
    // إعادة إنتاج مباشرة لعطل الإنتاج الفعلي: نجاح HTTP لكن بجسم لا يحمل binarySecurityToken/
    // clearanceStatus/reportingStatus صالحة — يجب أن يُرفَض برسالة واضحة تميّزه عن رفض حقيقي من زاتكا.
    mockFetchOnce(200, { unexpectedField: "not a real ZATCA response" });
    const xml = buildDocumentXml(sampleDocument());

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials,
      kind: "reporting",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) throw new Error("expected rejected outcome");
    expect(outcome.reason).toContain("رد غير متوقع من زاتكا");
    expect(outcome.reason).not.toContain("بلا تفاصيل إضافية");
  });

  it("surfaces a clear, distinct reason when the connection to ZATCA itself fails (not a rejection)", async () => {
    // إعادة إنتاج العطل قيد التحقيق: fetch() ترمي (تعذّر الوصول لشبكة زاتكا) بدل أن تُعيد استجابة —
    // يجب أن يُرفَض (accepted:false) برسالة اتصال واضحة، لا أن يسقط signAndSubmitDocument كاستثناء
    // يُسقِط معاملة الترحيل بأكملها التي استدعته (راجع evaluateZatcaPostingGate).
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const xml = buildDocumentXml(sampleDocument());

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials,
      kind: "reporting",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) throw new Error("expected rejected outcome");
    expect(outcome.reason).toContain("تعذّر الاتصال");
    expect(outcome.signedXml).toContain("<ds:SignatureValue>");
  });

  it("returns certificateError:true with a clear Arabic message when the stored certificate is genuinely unparseable, without ever calling fetch", async () => {
    // شهادة تالفة فعلياً بلا أي علاقة بترميز base64 مزدوج — يجب أن تفشل حتى بعد محاولة فك ترميز
    // إضافي (راجع الاختبار التالي: الترميز المزدوج وحده لم يعد يُصنَّف certificateError بعد إصلاح
    // getCertificateInfo). يجب أن يُلتَقَط الخطأ هنا بدل أن يسقط كاستثناء خام غير معالَج، وبرسالة
    // واضحة تسمّي "الشهادة" صراحةً لا خطأ عام، وبلا أي محاولة اتصال فعلي بزاتكا إطلاقاً.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const xml = buildDocumentXml(sampleDocument());
    const genuinelyBrokenCert = "this-is-not-a-valid-certificate-at-all";

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials: { ...credentials, certificateBodyBase64: genuinelyBrokenCert },
      kind: "reporting",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) throw new Error("expected rejected outcome");
    expect(outcome.certificateError).toBe(true);
    expect(outcome.networkError).toBeFalsy();
    expect(outcome.reason).toContain("شهادة");
    expect(outcome.reason).not.toBe("خطأ داخلي في الخادم");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("transparently tolerates a double-base64-encoded certificate: signs and submits normally, no certificateError", async () => {
    // حالة حقيقية مُؤكَّدة فعلياً في الإنتاج: زاتكا أعادت binarySecurityToken مُرمَّزاً مرتين
    // لشركة فعلية — يجب أن يُوقَّع المستند وتُرسَل الفاتورة بشكل طبيعي، لا أن تُصنَّف
    // certificate_error، طالما فك ترميز إضافي واحد يُنتِج شهادة صالحة فعلاً.
    mockFetchOnce(200, { reportingStatus: "REPORTED" });
    const xml = buildDocumentXml(sampleDocument());
    const doubleEncodedCertBody = Buffer.from(credentials.certificateBodyBase64, "utf8").toString("base64");

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials: { ...credentials, certificateBodyBase64: doubleEncodedCertBody },
      kind: "reporting",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) throw new Error("expected accepted outcome");
    // الأهم: الشهادة المُضمَّنة فعلياً في XML الموقَّع يجب أن تكون الشكل الصحيح بعد فك الترميز
    // الإضافي، لا الجسم المزدوج الترميز كما وصل — وإلا استلمت زاتكا شهادة غير قابلة للتحليل فعلياً
    // رغم نجاح التوقيع محلياً.
    expect(outcome.signedXml).toContain(credentials.certificateBodyBase64);
    expect(outcome.signedXml).not.toContain(doubleEncodedCertBody);
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

  it("submits to the compliance endpoint and returns accepted:true when kind is 'compliance' and the check passes", async () => {
    const fetchMock = mockFetchOnce(200, { validationResults: { status: "PASS" } });
    const xml = buildDocumentXml(sampleDocument());

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials,
      kind: "compliance",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(fetchMock.mock.calls[0][0]).toContain("/compliance/invoices");
    expect(outcome.accepted).toBe(true);
  });

  // زاتكا قد تردّ 2xx على مسار الامتثال حتى لو "فشل" الفحص منطقياً (لا نعرف يقيناً أنها تستخدم كود
  // HTTP غير ناجح كما في clearance/reporting) — يجب ألا يُعامَل هذا كقبول رغم نجاح HTTP.
  it("does NOT treat a 2xx compliance response as accepted when its body carries real validation errors", async () => {
    mockFetchOnce(200, {
      validationResults: { status: "FAIL", errorMessages: [{ type: "ERROR", message: "خطأ في بيانات الفاتورة التجريبية" }] },
    });
    const xml = buildDocumentXml(sampleDocument());

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials,
      kind: "compliance",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) throw new Error("expected rejected outcome");
    expect(outcome.reason).toContain("خطأ في بيانات الفاتورة التجريبية");
  });

  // نفس الفحص الدفاعي أعلاه يجب ألا يُطبَّق على clearance/reporting — هناك النجاح 2xx يعني قبولاً
  // حقيقياً دائماً (زاتكا تستخدم كود الحالة نفسه للتمييز، كما تأكَّد فعلياً من 401 في الإنتاج).
  it("treats a 2xx clearance response as accepted even if validationResults happens to carry warnings", async () => {
    mockFetchOnce(200, { clearanceStatus: "CLEARED", validationResults: { warningMessages: [{ type: "WARNING", message: "تنبيه غير حاجز" }] } });
    const xml = buildDocumentXml(sampleDocument());

    const outcome = await signAndSubmitDocument({
      xml,
      uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      environment: "sandbox",
      credentials,
      kind: "clearance",
      qrBaseParams: { sellerName: "شركة أثر التجريبية", sellerVat: "300000000000003", isoTimestamp: "2026-08-01T10:00:00Z", invoiceTotal: 115, vatTotal: 15 },
    });

    expect(outcome.accepted).toBe(true);
  });
});

describe("resolveZatcaSubmissionKind", () => {
  it("uses clearance/reporting only for a company on a production CSID", () => {
    expect(resolveZatcaSubmissionKind("production", "standard")).toBe("clearance");
    expect(resolveZatcaSubmissionKind("production", "simplified")).toBe("reporting");
  });

  // تأكَّد فعلياً في الإنتاج: شهادة اختبار (Compliance CSID) ترفض clearance/single بـ401 — لا يجوز
  // استخدام مسار التخليص/الإبلاغ إلا بشهادة إنتاج فعلية.
  it("uses compliance for a company still on a compliance CSID, regardless of invoice subtype", () => {
    expect(resolveZatcaSubmissionKind("compliance", "standard")).toBe("compliance");
    expect(resolveZatcaSubmissionKind("compliance", "simplified")).toBe("compliance");
  });

  it("uses compliance for a company that hasn't onboarded to ZATCA's certificate flow in a recognized state", () => {
    expect(resolveZatcaSubmissionKind("not_onboarded", "standard")).toBe("compliance");
  });
});
