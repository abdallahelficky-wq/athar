import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkInvoiceCompliance,
  clearInvoice,
  extractRejectionReasons,
  hasValidationErrors,
  reportInvoice,
  requestComplianceCsid,
  requestProductionCsid,
} from "./apiClient";

// قيمتان مختلفتان عمداً — canonical (بعد أي تطبيع محلي، للتوقيع) وraw (كما وصلت من زاتكا حرفياً،
// لترويسة Basic Auth) — لإثبات أن buildBasicAuthHeader تستخدم raw تحديداً لا canonical.
const CREDENTIALS = {
  certificateBodyBase64: "ZmFrZS1jZXJ0LWJvZHk=",
  rawCertificateBodyBase64: "cmF3LWNlcnQtYm9keQ==",
  secret: "fake-secret",
};

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
    // يجب استخدام الشكل الخام (rawCertificateBodyBase64) في الترويسة، لا الشكل القانوني — عطل إنتاج
    // فعلي مؤكَّد: استخدام القانوني هنا يُنتِج ترويسة زاتكا لم تُصدرها هي بالذات، فترفضها بـ401 فارغ.
    const decoded = Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe(`${CREDENTIALS.rawCertificateBodyBase64}:${CREDENTIALS.secret}`);
    expect(decoded).not.toBe(`${CREDENTIALS.certificateBodyBase64}:${CREDENTIALS.secret}`);
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

  // تصحيح: كنا نظنّ /compliance (بلا /invoices) صحيحاً بناءً على أن "Invalid-OTP" هناك بدا كرفض
  // تطبيقي حقيقي — دليل onboardingDiagnostics صحَّح هذا: إرسال فاتورة فعلية إلى /compliance أعاد
  // "Missing-OTP"، أي أن /compliance تُعامِل أي طلب إليها كطلب إصدار CSID (تحتاج OTP) لأنها هي مسار
  // الإصدار نفسه، لا مساراً مشتركاً. /compliance/invoices هو المسار الصحيح لفحص امتثال الفاتورة.
  it("checkInvoiceCompliance posts to /compliance/invoices, with Basic auth not an OTP header", async () => {
    const fetchMock = mockFetchOnce(200, { validationResults: { status: "PASS" } });
    await checkInvoiceCompliance({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "aW52b2ljZQ==", invoiceHash: "abc==", uuid: "u-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance/invoices");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(init.headers.OTP).toBeUndefined();
  });

  it("defaults Accept-Language to ar when not specified", async () => {
    const fetchMock = mockFetchOnce(200, { clearanceStatus: "CLEARED" });
    await clearInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe("ar");
  });

  // نقطة الانطلاق لهذا الخيار: قالب الرسالة العربية من زاتكا نفسها وصل مشوَّهاً نحوياً لقاعدة
  // BR-KSA-EN16931-01 (علامة اقتباس قبل النقطتين بدل بعدها)، مما أعاق تشخيص القيمة المتوقَّعة بدقة
  // عبر ثلاث محاولات متتالية — راجع سبب الحصر بفحص الامتثال فقط في submission.test.ts.
  it("honors an explicit acceptLanguage override on checkInvoiceCompliance", async () => {
    const fetchMock = mockFetchOnce(200, { validationResults: { status: "PASS" } });
    await checkInvoiceCompliance({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z", acceptLanguage: "en" });
    expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe("en");
  });

  it("surfaces a non-2xx response as ok:false with the parsed error body intact, and httpError:false since the body has a recognizable rejection structure", async () => {
    mockFetchOnce(400, {
      validationResults: { status: "FAIL", errorMessages: [{ type: "ERROR", message: "رقم ضريبي غير صالح" }] },
    });
    const result = await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.httpError).toBeFalsy();
    expect(extractRejectionReasons(result.data)).toBe("رقم ضريبي غير صالح");
  });

  // إعادة إنتاج مباشرة لعطل إنتاج فعلي: زاتكا أعادت 401 (أو أي كود مصادقة/توجيه مشابه) بجسم فارغ
  // تماماً — response.json() يرمي، لا شيء يُسجَّل الكود الفعلي، ويُعامَل كرفض فعلي بلا تفاصيل رغم
  // أن زاتكا لم تُقيِّم المستند إطلاقاً. يجب أن يُصنَّف httpError:true تحديداً بسبب كود الحالة نفسه
  // (401)، بصرف النظر التام عن الجسم (حتى لو كان فارغاً كما هنا).
  it("marks a 401 with an empty body as httpError:true (auth failure, not a document rejection)", async () => {
    mockFetchOnce(401, undefined, "Unauthorized");
    const result = await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.statusText).toBe("Unauthorized");
    expect(result.httpError).toBe(true);
    expect(result.data).toBeNull();
  });

  it("marks a 404 as httpError:true even if it somehow carries a JSON body (routing failure, not a document rejection)", async () => {
    mockFetchOnce(404, { message: "Not Found" }, "Not Found");
    const result = await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.httpError).toBe(true);
  });

  it("marks a 500 with an HTML error page body as httpError:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
        text: async () => "<html><body>502 Bad Gateway</body></html>",
        headers: { forEach: () => undefined },
      }),
    );
    const result = await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.httpError).toBe(true);
    expect(result.data).toBeNull();
  });

  it("does NOT mark a 400 with a real validation body as httpError (a genuine rejection is not an httpError)", async () => {
    mockFetchOnce(400, { validationResults: { errorMessages: [{ type: "ERROR", message: "خطأ في البيانات" }] } });
    const result = await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.httpError).toBeFalsy();
  });

  // كان السجلّ السابق يطبع فقط الجسم المُحلَّل (data)، وهو null لو فشل تحليله كـJSON — عديم الفائدة
  // تماماً للتشخيص، وهذا تحديداً ما جعل عطلاً حقيقياً في الإنتاج (401 بجسم فارغ) غير قابل للتفسير.
  // الآن يجب أن تظهر الصورة الكاملة: كود الحالة، statusText، الترويسات، والنص الخام قبل أي تحليل.
  it("logs the full HTTP picture (status, statusText, headers, raw text body) on every non-2xx response", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
        text: async () => "",
        headers: { forEach: (cb: (value: string, key: string) => void) => cb("nginx/1.18.0", "server") },
      }),
    );

    await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });

    const loggedCall = consoleErrorSpy.mock.calls.find((call) => String(call[0]).includes("[zatcaRequest]"));
    expect(loggedCall).toBeDefined();
    const logged = String(loggedCall![0]);
    expect(logged).toContain("status=401");
    expect(logged).toContain("Unauthorized");
    expect(logged).toContain("/invoices/clearance/single");
    expect(logged).toContain("nginx/1.18.0");
    consoleErrorSpy.mockRestore();
  });

  it("extractRejectionReasons includes each error's code, numbered, when there are several", async () => {
    mockFetchOnce(400, {
      validationResults: {
        status: "FAIL",
        errorMessages: [
          { type: "ERROR", code: "BR-CO-15", message: "مجموع القيمة المضافة غير متطابق" },
          { type: "ERROR", code: "BR-KSA-42", message: "رقم ضريبي غير صالح" },
        ],
      },
    });
    const result = await clearInvoice({ environment: "sandbox", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    const reason = extractRejectionReasons(result.data);
    expect(reason).toContain("1. [BR-CO-15] مجموع القيمة المضافة غير متطابق");
    expect(reason).toContain("2. [BR-KSA-42] رقم ضريبي غير صالح");
  });

  // كان هذا الفرع يُنتِج سابقاً "رفضت زاتكا الفاتورة بلا تفاصيل إضافية" — رسالة عامة عديمة الفائدة
  // بلا أي معلومة فعلية، وهذا تحديداً ما تعذَّر تشخيصه في الإنتاج (لا تفاصيل، ولا سجلّ خادم أيضاً).
  // الآن، بدل الصمت، تُعرَض الاستجابة الخام نفسها — حتى لو اختلف شكلها عمّا هو مفترَض هنا.
  it("extractRejectionReasons shows the raw response instead of a generic message when its shape doesn't match any known error structure", () => {
    const unexpectedShape = { someOtherField: "زاتكا قد تُعيد شكلاً مختلفاً لم نتحقق منه بعد" };
    const reason = extractRejectionReasons(unexpectedShape as never);
    expect(reason).not.toContain("بلا تفاصيل إضافية");
    expect(reason).toContain("someOtherField");
    expect(reason).toContain("زاتكا قد تُعيد شكلاً مختلفاً لم نتحقق منه بعد");
  });

  it("extractRejectionReasons handles a genuinely empty response without throwing", () => {
    expect(() => extractRejectionReasons(null)).not.toThrow();
    expect(extractRejectionReasons(null).length).toBeGreaterThan(0);
  });

  // hasValidationErrors تُستخدَم فقط للتحقّق الدفاعي على مسار الامتثال (checkInvoiceCompliance، /compliance) في
  // submission.ts — لأن زاتكا هناك قد تردّ 2xx حتى لو "فشل" الفحص منطقياً، بخلاف
  // clearance/reporting حيث الفشل يُعبَّر عنه بكود HTTP غير ناجح.
  it("hasValidationErrors is true only when errorMessages is a non-empty array, not for warnings alone", () => {
    expect(hasValidationErrors({ validationResults: { errorMessages: [{ type: "ERROR", message: "x" }] } })).toBe(true);
    expect(hasValidationErrors({ validationResults: { warningMessages: [{ type: "WARNING", message: "x" }] } })).toBe(false);
    expect(hasValidationErrors({ validationResults: { status: "PASS" } })).toBe(false);
    expect(hasValidationErrors(null)).toBe(false);
    expect(hasValidationErrors({})).toBe(false);
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

// إعادة إنتاج العطل قيد التحقيق: fetch() نفسها ترمي (DNS/timeout/رفض اتصال...) قبل وصول أي استجابة
// HTTP إطلاقاً — بلا هذا الالتقاط كانت تسقط كاستثناء خام يُسقِط معاملة Prisma بأكملها التي استدعتها
// (بما فيها فاتورة نقطة بيع مبسّطة كانت ستُرحَّل بصرف النظر عن نتيجة هذا الإرسال أصلاً).
describe("apiClient network-failure handling (fetch itself throws)", () => {
  it("surfaces a fetch rejection as ok:false with networkError:true instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await clearInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.networkError).toBe(true);
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });

  it("also protects reportInvoice (the B2C/simplified submission path) the same way", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND gw-fatoora.zatca.gov.sa")));
    const result = await reportInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.networkError).toBe(true);
  });
});

// كان هذا النداء بلا أي مهلة زمنية إطلاقاً — انتظار غير محدود بلا استجابة أو خطأ من زاتكا كان
// يعني، قبل نقل هذا النداء خارج أي معاملة قاعدة بيانات مفتوحة (راجع postingGate.ts)، تعليق تلك
// المعاملة حتى مهلتها الخاصة (فانتهت فعلياً بعطل إنتاج). الآن، حتى بلا معاملة مفتوحة، ما زال
// المستخدم ينتظر أمام الشاشة، فمهلة صريحة تمنع انتظاراً غير محدود لو تعلّق اتصال زاتكا نفسه.
describe("apiClient request timeout", () => {
  it("attaches an AbortSignal to every outbound request so a hung connection cannot block forever", async () => {
    const fetchMock = mockFetchOnce(200, { reportingStatus: "REPORTED" });
    await reportInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it("treats an aborted/timed-out request the same as any other connection failure (networkError, not a throw)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        return Promise.reject(err);
      }),
    );
    const result = await clearInvoice({ environment: "production", credentials: CREDENTIALS, signedInvoiceBase64: "x", invoiceHash: "y", uuid: "z" });
    expect(result.ok).toBe(false);
    expect(result.networkError).toBe(true);
  });
});

// عطل إنتاج فعلي مؤكَّد: زاتكا أعادت HTTP 202 (نجاح فعلي، فحص امتثال بتحذيرات لا رفض) لكن
// reportingStatus وصلت null حرفياً (لا غائبة) — z.string().optional() يرفض null، فكان هذا الرد
// الناجح فعلياً يُصنَّف malformedResponse ثم "rejected" لاحقاً في postingGate.ts. راجع التعليق
// الكامل فوق zatcaComplianceResponseSchema في apiClient.ts لتفاصيل الشكل الملاحَظ وحدود الثقة به.
describe("compliance nullable status placeholders", () => {
  const params = { environment: "simulation" as const, credentials: CREDENTIALS, signedInvoiceBase64: "eA==", invoiceHash: "hash", uuid: "test" };
  // الجسم كما وُصِف من السجلّ التشخيصي — بما فيه حقول لم يتوقّعها مخططنا أصلاً (status على مستوى كل
  // رسالة، qrSellertStatus/qrBuyertStatus بخطأيهما الإملائيين الظاهرين) لإثبات أنها تُسقَط بأمان.
  const observedResponse = {
    validationResults: {
      infoMessages: [{ type: "INFO", code: "XSD_ZATCA_VALID", message: "Complied with UBL 2.1 standards in line with ZATCA specifications", status: "PASS" }],
      warningMessages: [{ type: "WARNING", code: "BR-KSA-F-08", message: "Please recheck the CRN value", status: "WARNING" }],
      errorMessages: [],
      status: "WARNING",
    },
    reportingStatus: null,
    clearanceStatus: "CLEARED",
    qrSellertStatus: null,
    qrBuyertStatus: null,
  };

  it("accepts the observed HTTP 202 response without losing warnings", async () => {
    mockFetchOnce(202, observedResponse);
    const result = await checkInvoiceCompliance(params);
    expect(result.ok).toBe(true);
    expect(result.data?.clearanceStatus).toBe("CLEARED");
    expect(result.data?.validationResults?.warningMessages?.[0].code).toBe("BR-KSA-F-08");
    expect(hasValidationErrors(result.data)).toBe(false);
  });

  // نطاق الإصلاح مقصور على مسار الامتثال حصراً — clearance/reporting الحقيقيَّان يستمران على
  // المخطط الصارم بلا أي تطبيع، لأن شكل ردّيهما الفعلي لم يُلاحَظ بعد.
  it.each([clearInvoice, reportInvoice])("does not relax clearance/reporting schemas the same way", async (submit) => {
    mockFetchOnce(202, observedResponse);
    const result = await submit(params);
    expect(result.ok).toBe(false);
    expect(result.malformedResponse).toBe(true);
  });

  // كلا الحالتين null معاً يجب أن يبقيا مرفوضين — التطبيع يزيل null الفردي فقط ليعادل "غائب"، لا
  // يُسقِط شرط .refine() الذي يتطلّب حقلاً واحداً معرَّفاً على الأقل من الثلاثة.
  it.each([{}, null, { reportingStatus: null, clearanceStatus: null }, { reportingStatus: 42 }, { validationResults: null }])(
    "still rejects a genuinely malformed compliance response %j",
    async (body) => {
      mockFetchOnce(202, body);
      const result = await checkInvoiceCompliance(params);
      expect(result.ok).toBe(false);
      expect(result.malformedResponse).toBe(true);
    },
  );

  it("still preserves real validation errors in a response that also carries the nullable placeholders", async () => {
    mockFetchOnce(202, { ...observedResponse, validationResults: { status: "ERROR", errorMessages: [{ type: "ERROR", code: "INVALID", message: "Invalid invoice" }] } });
    const result = await checkInvoiceCompliance(params);
    expect(hasValidationErrors(result.data)).toBe(true);
  });
});
