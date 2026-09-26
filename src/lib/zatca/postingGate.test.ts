import { spawn } from "child_process";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { evaluateZatcaPostingGate, submitZatcaChainDocument, reserveZatcaChainForPosting } from "./postingGate";
import * as credentialsModule from "./credentials";

vi.mock("./credentials", () => ({
  loadCompanyZatcaCredentials: vi.fn(),
  zatcaEnvironmentMismatchMessage: (issuedFor: string, requested: string) =>
    `شهادة ربط زاتكا الحالية لهذه الشركة صادرة لبيئة "${issuedFor}"، بينما الشركة مضبوطة الآن على بيئة "${requested}"`,
}));

// كل استدعاءات loadCompanyZatcaCredentials في هذا الملف تمرّ عبر هاتين المساعدتين بدل القيمة
// الخام مباشرة — منذ أصبحت الدالة تُعيد LoadZatcaCredentialsResult (نتيجة مُميَّزة) لا
// ResolvedZatcaCredentials | null كما كانت — راجع credentials.ts.
function okCreds(c: { certificateBodyBase64: string; secret: string; privateKeyPem: string }) {
  // rawCertificateBodyBase64 = certificateBodyBase64 هنا افتراضياً — الفرق بين الشكلين مُختبَر
  // مباشرة في apiClient.test.ts/credentials.test.ts، لا في هذا الملف.
  return { ok: true as const, credentials: { rawCertificateBodyBase64: c.certificateBodyBase64, ...c } };
}
const NOT_CONFIGURED = { ok: false as const, reason: "not_configured" as const };

// evaluateZatcaPostingGate/reserveZatcaChainForPosting لا يقبلان tx خارجية إطلاقاً بعد اليوم —
// كلاهما يحجز عبر prisma.$transaction() الحقيقية بنفسه دائماً. نموِّه هنا بتنفيذ الاستدعاء فوراً
// بنفس شكل tx وهمية، فلا حاجة لقاعدة بيانات فعلية لاختبار هذا المسار.
vi.mock("../prisma", () => ({
  prisma: {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: vi.fn().mockResolvedValue([{ zatcaNextIcv: 5 }]), company: { update: vi.fn().mockResolvedValue({}) } }),
    ),
  },
}));

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
  workDir = await mkdtemp(path.join(tmpdir(), "zatca-posting-gate-test-"));
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

const STANDARD_CUSTOMER = { ...SIMPLIFIED_CUSTOMER, customerType: "business", vatNumber: "300000000000010", name: "شركة العميل" };

const LINES = [
  { description: "خدمة", quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, taxCategoryCode: "S", taxExemptionReason: null },
];

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
  vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockReset();
});

describe("evaluateZatcaPostingGate", () => {
  it("is a no-op (not_applicable, always proceed) when the company is not onboarded", async () => {
    const decision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaOnboardingStatus: "not_onboarded" },
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });
    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("not_applicable");
    expect(decision.zatcaFields.icv).toBeUndefined();
  });

  // عطل إنتاج فعلي مؤكَّد كان هنا: هذه الحالة كانت تُصنَّف pending_clearance/pending_reporting —
  // اسمان يوحيان بأن زاتكا استلمت المستند وتُعالجه، بينما لا طلب وصلها إطلاقاً (fetchSpy أدناه
  // يثبت ذلك مباشرة). not_submitted الآن + رسالة صريحة تقول ذلك بالنص، لا تخمين.
  it("reserves the ICV/PIH chain but does not call the live API when the company has no CSID credentials yet — reports not_submitted, not a ZATCA-sounding status", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(NOT_CONFIGURED);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("not_submitted");
    expect(decision.zatcaFields.icv).toBe(5);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(decision.rejectionReason).toContain("لم يُرسَل");
  });

  // البند 3 من طلب المستخدم: هذا الترابط انكسر بصمت مرة (راجع تعليق isProduction في credentials.ts)
  // — يجب ألا يتكرر بلا اختبار يكشفه فوراً. company.zatcaEnvironment هنا "production" عمداً
  // (البيئة/المضيف)، بينما zatcaOnboardingStatus لا يزال "compliance" (مرحلة الربط) — التمرير
  // الصحيح لـloadCompanyZatcaCredentials يعتمد على onboardingStatus لا environment، فيجب أن تصل
  // شهادة الاختبار (لا شهادة الإنتاج غير الموجودة بعد) وأن يصل الاتصال الشبكي الفعلي.
  it("loads the compliance credential and reaches the HTTP layer when environment is 'production' but onboardingStatus is still 'compliance'", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    const fetchMock = mockFetchOnce(200, { validationResults: { status: "PASS" } });

    const decision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaEnvironment: "production", zatcaOnboardingStatus: "compliance" },
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(credentialsModule.loadCompanyZatcaCredentials).toHaveBeenCalledWith("company-1", "production", "compliance");
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toContain("/compliance/invoices");
    expect(decision.zatcaFields.zatcaStatus).toBe("compliance_checked");
  });

  it("proceeds and marks cleared when ZATCA accepts a standard (clearance) submission", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(200, { clearanceStatus: "CLEARED" });

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("cleared");
    expect(decision.zatcaFields.zatcaClearedOrReportedAt).toBeInstanceOf(Date);
  });

  it("blocks posting entirely for a rejected STANDARD (clearance) invoice, even though the ICV/hash were reserved", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(400, { validationResults: { errorMessages: [{ type: "ERROR", message: "الرقم الضريبي للمشتري غير صحيح" }] } });

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(false);
    expect(decision.zatcaFields.zatcaStatus).toBe("rejected");
    expect(decision.zatcaFields.icv).toBe(5);
    expect(decision.rejectionReason).toContain("الرقم الضريبي للمشتري غير صحيح");
  });

  // إعادة إنتاج مباشرة لعطل إنتاج فعلي ثانٍ: زاتكا أعادت استجابة غير ناجحة بجسم فارغ تماماً (null)
  // — لا validationResults، لا أخطاء. كانت تُسجَّل خطأً كـ"rejected" (زاتكا قيَّمت المستند ورفضته)
  // رغم أن زاتكا لم تُقيِّم شيئاً على الإطلاق — هذا فشل نقل/مصادقة (401 هنا)، يحتاج مراجعة إعداد
  // الربط، لا تصحيح بيانات الفاتورة. يجب أن يُصنَّف submission_failed، والرسالة يجب أن تذكر كود
  // الحالة الفعلي (401) صراحةً.
  it("classifies a 401 with an empty body as submission_failed (not rejected), with the HTTP status in the message", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(401, undefined, "Unauthorized");

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(false);
    expect(decision.zatcaFields.zatcaStatus).toBe("submission_failed");
    expect(decision.rejectionReason).toContain("401");
    expect(decision.rejectionReason).not.toContain("رفضت زاتكا الفاتورة");
  });

  // إعادة إنتاج مباشرة لعطل إنتاج فعلي ثالث: زاتكا أعادت 2xx (نجاح فعلي — فحص امتثال بتحذيرات لا
  // رفض) لكن الجسم لم يطابق zatcaComplianceResponseSchema المتوقَّع (قبل إصلاحها في apiClient.ts) —
  // كان هذا "رفضنا نجاحاً" يُصنَّف "rejected" رغم أن زاتكا لم تُقيِّم المستند رفضاً على الإطلاق. أي
  // 2xx لم يطابق الشكل المتوقَّع (malformedResponse) يجب أن يُصنَّف submission_failed مثل httpError
  // تماماً، لا rejected — راجع تعليق malformedResponse في submission.ts.
  it("classifies a 2xx response that fails schema validation as submission_failed (not rejected)", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    // جسم 2xx حقيقي لا يحمل أياً من clearanceStatus/reportingStatus/validationResults — يفشل
    // .refine() في zatcaSubmissionResponseSchema بصرف النظر عن أي تطبيع لاحق.
    mockFetchOnce(200, { unexpectedField: "زاتكا غيّرت شكل الرد" });

    const decision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaOnboardingStatus: "compliance" },
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.zatcaFields.zatcaStatus).toBe("submission_failed");
    expect(decision.zatcaFields.zatcaStatus).not.toBe("rejected");
  });

  it("does NOT emit the 'رفضت زاتكا مستنداً' rejection log for an httpError (auth/transport failure) — it's already logged in full inside zatcaRequest", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(401, undefined, "Unauthorized");

    await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 175,
      vatTotal: 22.83,
    });

    const rejectionLog = consoleErrorSpy.mock.calls.find((call) => String(call[0]).includes("رفضت زاتكا مستنداً"));
    expect(rejectionLog).toBeUndefined();
    consoleErrorSpy.mockRestore();
  });

  // كان هذا المسار صامتاً تماماً بلا أي سطر سجلّ على الإطلاق قبل هذا الإصلاح — رفض فعلي في
  // الإنتاج لا يترك أي أثر في سجلّات الخادم، فلا وسيلة لتشخيصه إلا بقراءة zatcaResponseRaw من
  // القاعدة مباشرة. يجب أن يُسجَّل الآن بالاستجابة الخام الكاملة، ومعرّف/اسم الشركة، ورقم المستند.
  it("logs the full raw ZATCA response server-side (with company and document number) on a genuine rejection", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(400, { validationResults: { errorMessages: [{ type: "ERROR", code: "BR-KSA-42", message: "الرقم الضريبي للمشتري غير صحيح" }] } });

    await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    const loggedCall = consoleErrorSpy.mock.calls.find((call) => String(call[0]).includes("رفضت زاتكا مستنداً"));
    expect(loggedCall).toBeDefined();
    const logged = String(loggedCall![0]);
    expect(logged).toContain(COMPANY.id);
    expect(logged).toContain(COMPANY.name);
    expect(logged).toContain("INV-00001");
    expect(logged).toContain("BR-KSA-42");
    expect(logged).toContain("الرقم الضريبي للمشتري غير صحيح");
    consoleErrorSpy.mockRestore();
  });

  it("does NOT log a rejection-style message for network failures or certificate errors (those already have their own distinct logging)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 175,
      vatTotal: 22.83,
    });

    const rejectionLog = consoleErrorSpy.mock.calls.find((call) => String(call[0]).includes("رفضت زاتكا مستنداً"));
    expect(rejectionLog).toBeUndefined();
    consoleErrorSpy.mockRestore();
  });

  it("keeps a rejected SIMPLIFIED (reporting) invoice postable, marking it rejected for later retry", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(400, { validationResults: { errorMessages: [{ type: "ERROR", message: "خطأ تنسيق" }] } });

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    // مبسّطة: تُرحَّل رغم الرفض (سُلِّمت للعميل فعلاً) لكن بحالة rejected لإعادة المحاولة لاحقاً
    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("rejected");
  });

  // إعادة إنتاج مباشرة للعطل قيد التحقيق: شركة مرتبطة بزاتكا فعلياً، تبيع لعميل نقدي (فاتورة
  // مبسّطة، حال أي بيع نقطة بيع كاش عادي) — لكن خادم الشركة لا يقدر يصل شبكة زاتكا فعلياً (fetch
  // نفسها ترمي، لا مجرد رد رفض). قبل الإصلاح كان هذا الاستثناء الخام يسقط من evaluateZatcaPostingGate
  // ليُسقِط معاملة إنشاء الفاتورة بأكملها في createSalesInvoice (500 عام، لا فاتورة تُنشأ إطلاقاً)
  // رغم أن نفس الوردية بالضبط، لو رفضتها زاتكا صراحةً بدل تعذّر الاتصال، كانت ستُرحَّل بلا مشكلة
  // (الاختبار السابق مباشرة). فشل الاتصال يجب أن يُعامَل بلا أقل من معاملة الرفض الصريح، لا أسوأ منها.
  // كما يجب ألا تُسجَّل كـ"rejected" — تلك مخصَّصة لرفض فعلي من زاتكا يحتاج تصحيح بيانات، بينما
  // تعذّر الاتصال يحتاج فقط إعادة إرسال لاحقاً (راجع submission_failed).
  it("keeps a SIMPLIFIED (POS cash sale) invoice postable when ZATCA's network is simply unreachable, and marks it submission_failed (not rejected)", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 175,
      vatTotal: 22.83,
    });

    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("submission_failed");
    expect(decision.rejectionReason).toContain("تعذّر الاتصال");
  });

  it("still blocks a STANDARD (clearance) invoice when ZATCA is unreachable, same as an explicit rejection", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(false);
    expect(decision.zatcaFields.zatcaStatus).toBe("submission_failed");
  });

  // إعادة إنتاج مباشرة لعطل إنتاج فعلي لاحق: شهادة زاتكا مخزَّنة لهذه الشركة بصيغة غير صالحة
  // (asn1 encoding routines::wrong tag) — يجب أن تُصنَّف certificate_error، لا submission_failed
  // ولا rejected، لأنها فئة مختلفة تماماً: لا عطل شبكة عابر (قد يُحَل نفسه) ولا رفض فعلي من زاتكا
  // (يحتاج تصحيح بيانات المستند)، بل شهادة معطوبة لن تعمل أبداً حتى يُصلَح إعداد الربط نفسه.
  // شهادة تالفة فعلياً هنا (لا مُرمَّزة base64 مرتين فقط) — تلك أصبحت مُتسامَحاً معها (راجع
  // الاختباريْن التاليين مباشرة)، فلم تعد تصلح لإعادة إنتاج certificate_error بعد إصلاحها.
  it("keeps a SIMPLIFIED invoice postable but marks it certificate_error (not submission_failed) when the stored certificate is genuinely unparseable", async () => {
    const malformedCredentials = { ...credentials, certificateBodyBase64: "this-is-not-a-valid-certificate-at-all" };
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(malformedCredentials));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 175,
      vatTotal: 22.83,
    });

    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("certificate_error");
    expect(decision.rejectionReason).toContain("شهادة");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a STANDARD invoice when the stored certificate is genuinely unparseable, same as an explicit rejection", async () => {
    const malformedCredentials = { ...credentials, certificateBodyBase64: "this-is-not-a-valid-certificate-at-all" };
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(malformedCredentials));

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(false);
    expect(decision.zatcaFields.zatcaStatus).toBe("certificate_error");
  });

  // الحالة الحقيقية المُؤكَّدة فعلياً في الإنتاج: فاتورة قياسية (B2B) — بالضبط النوع الذي فشل فعلاً
  // في الإنتاج — لشركة شهادتها المخزَّنة مُرمَّزة base64 مرتين. يجب أن تُخلَّص وتُرحَّل بنجاح، لا
  // أن تُصنَّف certificate_error ولا أن تُمنَع من الترحيل، طالما فك ترميز إضافي واحد ينجح فعلياً.
  it("clears and proceeds a STANDARD invoice normally when the stored certificate is merely double-base64-encoded (tolerated, not an error)", async () => {
    const doubleEncodedCredentials = { ...credentials, certificateBodyBase64: Buffer.from(credentials.certificateBodyBase64, "utf8").toString("base64") };
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(doubleEncodedCredentials));
    mockFetchOnce(200, { clearanceStatus: "CLEARED" });

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("cleared");
  });

  // عطل الإنتاج الذي دفع لهذا الإصلاح بالكامل: كان ممكناً تمرير tx خاصة بالمستدعي إلى
  // evaluateZatcaPostingGate فتُفتَح معاملة تحتوي الاتصال الشبكي البطيء بزاتكا نفسه (راجع الحادثة
  // في تقرير STEP 1: 8228-8502ms داخل معاملة سقفها 8000ms). الحقل أُزيل نهائياً من
  // EvaluateZatcaPostingGateParams — هذا اختبار على مستوى النوع (لا وقت تشغيل): لو أُعيد أي حقل
  // tx إلى الواجهة، Params يحتوي "tx" مجدداً، HasTx تصبح true، وإسنادها لمتغيّر مُعلَن false
  // يفشل تحت tsc (يعني فشل بناء المشروع بالكامل، لا فشل هذا الاختبار وحده فقط).
  it("never accepts an external tx again — EvaluateZatcaPostingGateParams has no tx field (regression guard)", () => {
    type Params = Parameters<typeof evaluateZatcaPostingGate>[0];
    type HasTx = "tx" extends keyof Params ? true : false;
    const hasTx: HasTx = false;
    expect(hasTx).toBe(false);
  });

  // نفس الضمان لـsubmitZatcaChainDocument (المرحلة 2) وreserveZatcaChainForPosting (المرحلة 1) —
  // كلتاهما مُصمَّمتان عمداً بلا معامل tx على الإطلاق، فلا مسار ممكن لإعادة فتح اتصال زاتكا داخل
  // معاملة قاعدة بيانات عبر أي منهما.
  it("never accepts an external tx on submitZatcaChainDocument or reserveZatcaChainForPosting either", () => {
    type SubmitParams = Parameters<typeof submitZatcaChainDocument>[0];
    type ReserveParams = Parameters<typeof reserveZatcaChainForPosting>[0];
    type SubmitHasTx = "tx" extends keyof SubmitParams ? true : false;
    type ReserveHasTx = "tx" extends keyof ReserveParams ? true : false;
    const submitHasTx: SubmitHasTx = false;
    const reserveHasTx: ReserveHasTx = false;
    expect(submitHasTx).toBe(false);
    expect(reserveHasTx).toBe(false);
  });

  // كل استدعاءات evaluateZatcaPostingGate في هذا الملف لا تمرّر tx إطلاقاً (المسار الوحيد الممكن
  // بعد اليوم) — يجب أن تحجز السلسلة عبر معاملة قصيرة مستقلة بنفسها (prisma.$transaction، مُموَّهة
  // أعلاه)، وأن يعمل بقية المنطق (الاتصال بزاتكا، بناء القرار) بلا أي تغيير.
  it("reserves the chain via its own prisma.$transaction and proceeds normally", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(200, { reportingStatus: "REPORTED" });

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(true);
    expect(decision.zatcaFields.zatcaStatus).toBe("reported");
    expect(decision.zatcaFields.icv).toBe(5);
  });

  // تأكَّد فعلياً في الإنتاج: 401 عند استخدام شهادة اختبار (Compliance CSID) مع clearance/single —
  // شركة لا تزال على شهادة اختبار يجب أن تُرسِل عبر مسار الامتثال (/compliance/invoices) فقط، لأي
  // نوع مستند (قياسي أو مبسّط)، لا clearance/reporting ولا /compliance (ذاك مسار إصدار CSID نفسه —
  // راجع apiClient.ts).
  it("submits through the compliance endpoint (not CSID issuance, not clearance/reporting) for a company still on a compliance CSID", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    const fetchMock = mockFetchOnce(200, { validationResults: { status: "PASS" } });

    const decision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaOnboardingStatus: "compliance" },
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(fetchMock.mock.calls[0][0]).toContain("/compliance/invoices");
    expect(fetchMock.mock.calls[0][0]).not.toContain("/invoices/clearance/single");
  });

  // نفس البند لكن لعميل مبسّط تحديداً — لا يوجد أي تفرّع بحسب النوع الفرعي في مسار الامتثال؛
  // الفاتورة المبسّطة يجب أن تصل /compliance/invoices تماماً كالقياسية، لا /invoices/reporting/single.
  it("submits through the compliance endpoint for a SIMPLIFIED invoice too, for a company still on a compliance CSID", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    const fetchMock = mockFetchOnce(200, { validationResults: { status: "PASS" } });

    const decision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaOnboardingStatus: "compliance" },
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(fetchMock.mock.calls[0][0]).toContain("/compliance/invoices");
    expect(fetchMock.mock.calls[0][0]).not.toContain("/invoices/reporting/single");
  });

  // فحص امتثال ناجح ليس تخليصاً/إبلاغاً فعلياً — المستند لم يُبلَّغ لزاتكا قانونياً بعد، فيجب ألا
  // يُصنَّف cleared/reported (قد يُوهِم بأن الفاتورة أصبحت نهائية أمام زاتكا وهي ليست كذلك)، ولا
  // يُملأ zatcaClearedOrReportedAt (لم يحدث تخليص/إبلاغ فعلي). البند 4 من طلب المستخدم: سياسة
  // الترحيل نفسها لا تتغيّر — فاتورة قياسية أو مبسّطة تُرحَّل دائماً هنا لأن الفحص "نجح" (لم تُرفَض).
  it("marks a successful compliance check as compliance_checked (not cleared/reported), with no zatcaClearedOrReportedAt, for both invoice subtypes", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));

    // الشكل الفعلي المُلاحَظ لرد امتثال ناجح (راجع apiClient.ts): HTTP 202، clearanceStatus
    // "CLEARED" (لا "PASS")، reportingStatus null حرفياً، بتحذيرات لا أخطاء.
    mockFetchOnce(202, { clearanceStatus: "CLEARED", reportingStatus: null, validationResults: { status: "WARNING", errorMessages: [], warningMessages: [{ type: "WARNING", code: "BR-KSA-F-08", message: "Recheck CRN" }] } });
    const standardDecision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaOnboardingStatus: "compliance" },
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });
    expect(standardDecision.proceedWithPosting).toBe(true);
    expect(standardDecision.zatcaFields.zatcaStatus).toBe("compliance_checked");
    expect(standardDecision.zatcaFields.zatcaClearedOrReportedAt).toBeUndefined();
    // البند الحرج: الرد الخام يحمل clearanceStatus="CLEARED" فعلياً (مخزَّن كما هو في
    // zatcaResponseRaw للتدقيق) — لكن هذا لا يجب أن يُسرِّب "cleared" إلى zatcaStatus المُقيَّم
    // فعلياً؛ ذلك محجوز حصراً لمسار الإنتاج (راجع isProductionSubmission في postingGate.ts).
    expect((standardDecision.zatcaFields.zatcaResponseRaw as { clearanceStatus?: string } | undefined)?.clearanceStatus).toBe("CLEARED");
    expect(standardDecision.zatcaFields.zatcaStatus).not.toBe("cleared");

    mockFetchOnce(202, { clearanceStatus: "CLEARED", reportingStatus: null, validationResults: { status: "WARNING", errorMessages: [], warningMessages: [{ type: "WARNING", code: "BR-KSA-F-08", message: "Recheck CRN" }] } });
    const simplifiedDecision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaOnboardingStatus: "compliance" },
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00002",
      documentUuid: "4df6eecf-2492-45a0-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });
    expect(simplifiedDecision.proceedWithPosting).toBe(true);
    expect(simplifiedDecision.zatcaFields.zatcaStatus).toBe("compliance_checked");
    expect(simplifiedDecision.zatcaFields.zatcaClearedOrReportedAt).toBeUndefined();
  });

  // البند 4: فاتورة قياسية تبقى ممنوعة من الترحيل عند رفض فعلي، بصرف النظر عن كون المسار امتثالاً
  // لا تخليصاً — نفس سياسة الرفض المعتادة، لا فرق بسبب مسار الإرسال.
  it("still blocks a STANDARD invoice when the compliance check itself reports real validation errors", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(okCreds(credentials));
    mockFetchOnce(200, {
      validationResults: { status: "FAIL", errorMessages: [{ type: "ERROR", message: "خطأ في بيانات الفاتورة التجريبية" }] },
    });

    const decision = await evaluateZatcaPostingGate({
      company: { ...COMPANY, zatcaOnboardingStatus: "compliance" },
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(false);
    expect(decision.zatcaFields.zatcaStatus).toBe("rejected");
    expect(decision.rejectionReason).toContain("خطأ في بيانات الفاتورة التجريبية");
  });

  // عطل إنتاج فعلي مؤكَّد: شهادة اختبار حقيقية (OTP فعلي من بوابة فاتورة) صادرة بينما بيئة الشركة
  // كانت sandbox — بوابة مطورين عامة ببيانات وهمية منفصلة تماماً لا تعرف هذه الشهادة إطلاقاً، فترفض
  // بـ401 بلا أي علاقة بصحة الشهادة/التوقيع. يجب ألا تُحاوَل fetch إطلاقاً هنا (فشل مضمون سلفاً)،
  // ويجب تصنيفه certificate_error (مشكلة إعداد ربط لن تُحَل بإعادة محاولة) لا submission_failed/rejected.
  it("never calls fetch and marks certificate_error when the stored CSID was issued for a different environment", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue({
      ok: false,
      reason: "environment_mismatch",
      issuedFor: "simulation",
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY, // env=sandbox في هذا الملف
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(decision.zatcaFields.zatcaStatus).toBe("certificate_error");
    expect(decision.rejectionReason).toContain("simulation");
    expect(decision.rejectionReason).toContain("sandbox");
  });

  it("still blocks a STANDARD invoice on an environment mismatch, same as any other certificate_error", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue({
      ok: false,
      reason: "environment_mismatch",
      issuedFor: "simulation",
    });

    const decision = await evaluateZatcaPostingGate({
      company: COMPANY,
      customer: STANDARD_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.proceedWithPosting).toBe(false);
    expect(decision.zatcaFields.zatcaStatus).toBe("certificate_error");
  });
});
