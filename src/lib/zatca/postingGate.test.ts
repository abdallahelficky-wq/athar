import { spawn } from "child_process";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { evaluateZatcaPostingGate } from "./postingGate";
import * as credentialsModule from "./credentials";

vi.mock("./credentials", () => ({ loadCompanyZatcaCredentials: vi.fn() }));

// بلا tx مُمرَّرة (مسار createSalesInvoice/postSalesInvoice المُعاد هيكلته) تحجز evaluateZatcaPostingGate
// السلسلة عبر prisma.$transaction() الحقيقية بنفسها — نموِّه هنا بتنفيذ الاستدعاء فوراً بنفس شكل
// fakeTx() أدناه (مُعاد تعريفها هنا محلياً تجنّباً لمشاكل ترتيب hoisting مع vi.mock)، فلا حاجة
// لقاعدة بيانات فعلية لاختبار هذا المسار.
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

function fakeTx() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ zatcaNextIcv: 5 }]),
    company: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as Parameters<typeof evaluateZatcaPostingGate>[0]["tx"];
}

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockReset();
});

describe("evaluateZatcaPostingGate", () => {
  it("is a no-op (not_applicable, always proceed) when the company is not onboarded", async () => {
    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
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

  it("reserves the ICV/PIH chain but does not call the live API when the company has no CSID credentials yet", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
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
    expect(decision.zatcaFields.zatcaStatus).toBe("pending_reporting");
    expect(decision.zatcaFields.icv).toBe(5);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proceeds and marks cleared when ZATCA accepts a standard (clearance) submission", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    mockFetchOnce(200, { clearanceStatus: "CLEARED" });

    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
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
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    mockFetchOnce(400, { validationResults: { errorMessages: [{ type: "ERROR", message: "الرقم الضريبي للمشتري غير صحيح" }] } });

    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
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

  it("keeps a rejected SIMPLIFIED (reporting) invoice postable, marking it rejected for later retry", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    mockFetchOnce(400, { validationResults: { errorMessages: [{ type: "ERROR", message: "خطأ تنسيق" }] } });

    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
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
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
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
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
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

  it("populates reservedChain whenever a chain was actually reserved, regardless of accept/reject outcome", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
    mockFetchOnce(200, { reportingStatus: "REPORTED" });

    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.reservedChain).toEqual({ icv: 5, invoiceHash: decision.zatcaFields.invoiceHash });
  });

  it("leaves reservedChain undefined when the company isn't onboarded (no chain to reserve at all)", async () => {
    const decision = await evaluateZatcaPostingGate({
      tx: fakeTx(),
      company: { ...COMPANY, zatcaOnboardingStatus: "not_onboarded" },
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES as never,
      grandTotal: 115,
      vatTotal: 15,
    });

    expect(decision.reservedChain).toBeUndefined();
  });

  // المسار المُعاد هيكلته (createSalesInvoice/postSalesInvoice) لا يمرّر tx إطلاقاً — يجب أن تحجز
  // evaluateZatcaPostingGate السلسلة عبر معاملة قصيرة مستقلة بنفسها (prisma.$transaction، مُموَّهة
  // أعلاه) بدل معاملة الاستدعاء، وأن يعمل بقية المنطق (الاتصال بزاتكا، بناء القرار) بلا أي تغيير.
  it("reserves the chain via its own prisma.$transaction when no tx is passed at all (the restructured call path)", async () => {
    vi.mocked(credentialsModule.loadCompanyZatcaCredentials).mockResolvedValue(credentials);
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
    expect(decision.reservedChain).toEqual({ icv: 5, invoiceHash: decision.zatcaFields.invoiceHash });
  });
});
