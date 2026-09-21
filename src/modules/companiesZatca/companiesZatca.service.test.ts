import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(), update: vi.fn() },
    companyZatcaCredential: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (operations) => Promise.all(operations)),
  },
}));

vi.mock("../../lib/zatca/apiClient", () => ({ requestComplianceCsid: vi.fn(), requestProductionCsid: vi.fn() }));
vi.mock("../../lib/zatca/secretBox", () => ({ encryptSecret: (value: string) => "encrypted:" + value, decryptSecret: (value: string) => value }));
vi.mock("../../lib/zatca/signing", () => ({ getCertificateInfo: () => ({ canonicalBodyBase64: "canonical" }) }));
vi.mock("../../lib/zatca/csr", () => ({ generateCsr: vi.fn(), verifyCsrLocally: vi.fn() }));
import { generateCsr, verifyCsrLocally } from "../../lib/zatca/csr";
import { requestComplianceCsid, requestProductionCsid } from "../../lib/zatca/apiClient";
import { prisma } from "../../lib/prisma";
import { requestCompanyProductionCsid, setCompanyZatcaEnvironment, requestCompanyComplianceCsid, generateCompanyCsr } from "./companiesZatca.service";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";

function mockCompany(overrides: Partial<{ zatcaEnvironment: string; zatcaOnboardingStatus: string }> = {}) {
  return {
    id: COMPANY_ID,
    tenantId: TENANT_ID,
    zatcaEnvironment: "sandbox",
    zatcaOnboardingStatus: "compliance",
    ...overrides,
  };
}

afterEach(() => {
  vi.mocked(prisma.company.findFirst).mockReset();
  vi.mocked(prisma.company.update).mockReset();
  vi.mocked(prisma.companyZatcaCredential.findUnique).mockReset();
});

describe("setCompanyZatcaEnvironment", () => {
  // عطل جمود فعلي مؤكَّد كان هنا: كان هذا الفحص يمنع الانتقال لبيئة "production" قبل صدور شهادة
  // إنتاج فعلية — لكن شهادة الإنتاج نفسها تُطلَب من مضيف البيئة الحالية (company.zatcaEnvironment)،
  // فيستحيل الوصول لشهادة إنتاج أصلاً بلا التحويل للبيئة أولاً. لا شهادة بعد ⇐ لا حارس يمنع التحويل.
  it("allows switching to production before a production CSID exists, when no live credential exists yet at all", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany({ zatcaOnboardingStatus: "compliance", zatcaEnvironment: "sandbox" }) as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.company.update).mockResolvedValue({} as never);

    await setCompanyZatcaEnvironment(TENANT_ID, COMPANY_ID, "production");
    expect(prisma.company.update).toHaveBeenCalledWith({ where: { id: COMPANY_ID }, data: { zatcaEnvironment: "production" } });
  });

  it("still blocks switching to production while a live credential exists for the current (different) environment", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany({ zatcaOnboardingStatus: "compliance", zatcaEnvironment: "sandbox" }) as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceCertEnc: "cert",
      complianceSecretEnc: "secret",
      productionCertEnc: null,
      productionSecretEnc: null,
    } as never);

    await expect(setCompanyZatcaEnvironment(TENANT_ID, COMPANY_ID, "production")).rejects.toThrow(/إعادة ضبط الربط/);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  // عطل الإنتاج الفعلي المؤكَّد الذي دفع لهذا الفحص: نقرة واحدة على القائمة المنسدلة كانت تُبطل
  // ربطاً فعّالاً بصمت (شهادة صادرة لبيئة تختلف عن البيئة الجديدة لا تعمل معها أبداً).
  it("blocks switching away from an environment that has a live compliance credential", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany({ zatcaEnvironment: "sandbox" }) as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceCertEnc: "cert",
      complianceSecretEnc: "secret",
      productionCertEnc: null,
      productionSecretEnc: null,
    } as never);

    await expect(setCompanyZatcaEnvironment(TENANT_ID, COMPANY_ID, "simulation")).rejects.toThrow(/إعادة ضبط الربط/);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("blocks switching away from production when a live production credential exists", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(
      mockCompany({ zatcaEnvironment: "production", zatcaOnboardingStatus: "production" }) as never,
    );
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceCertEnc: "cert",
      complianceSecretEnc: "secret",
      productionCertEnc: "prod-cert",
      productionSecretEnc: "prod-secret",
    } as never);

    await expect(setCompanyZatcaEnvironment(TENANT_ID, COMPANY_ID, "simulation")).rejects.toThrow(/إعادة ضبط الربط/);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("allows switching when no live credential exists yet for the current environment (e.g. before onboarding)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany({ zatcaOnboardingStatus: "not_onboarded" }) as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.company.update).mockResolvedValue({} as never);

    await setCompanyZatcaEnvironment(TENANT_ID, COMPANY_ID, "simulation");
    expect(prisma.company.update).toHaveBeenCalledWith({ where: { id: COMPANY_ID }, data: { zatcaEnvironment: "simulation" } });
  });

  it("allows re-selecting the same environment the company is already on (not a switch)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany({ zatcaEnvironment: "sandbox" }) as never);
    vi.mocked(prisma.company.update).mockResolvedValue({} as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceCertEnc: "cert",
      complianceSecretEnc: "secret",
      productionCertEnc: null,
      productionSecretEnc: null,
    } as never);

    await setCompanyZatcaEnvironment(TENANT_ID, COMPANY_ID, "sandbox");
    expect(prisma.company.update).toHaveBeenCalledWith({ where: { id: COMPANY_ID }, data: { zatcaEnvironment: "sandbox" } });
  });
});


describe("requestCompanyComplianceCsid", () => {
  it("clears reconciliation evidence when replacing the compliance certificate", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany() as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      csrPem: "test-csr", complianceRequestId: "old-request",
      lastMissingComplianceSteps: ["simplified-compliant"], lastComplianceStepsCheckedAt: new Date(),
    } as never);
    vi.mocked(requestComplianceCsid).mockResolvedValue({ ok: true, status: 200,
      data: { requestID: "new-request", binarySecurityToken: "raw", secret: "test-secret" },
    } as never);
    await requestCompanyComplianceCsid(TENANT_ID, COMPANY_ID, "test-otp");
    expect(prisma.companyZatcaCredential.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ complianceRequestId: "new-request",
        lastMissingComplianceSteps: [], lastComplianceStepsCheckedAt: null }),
    }));
  });
});


describe("generateCompanyCsr environment selection", () => {
  it.each(["sandbox", "simulation", "production"])("uses stored %s environment even if an old client sends a conflicting production flag", async (environment) => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...mockCompany({ zatcaEnvironment: environment }),
      name: "Test Company", vatNumber: "300000000000003", crNumber: "1010101010",
    } as never);
    vi.mocked(generateCsr).mockResolvedValue({ privateKeyPem: "test-key", csrPem: "test-csr" });
    vi.mocked(verifyCsrLocally).mockResolvedValue(true);
    await generateCompanyCsr(TENANT_ID, COMPANY_ID, { production: environment !== "production", invoiceType: "both" });
    expect(generateCsr).toHaveBeenLastCalledWith(expect.objectContaining({ environment, invoiceType: "both" }));
  });
});

describe("production CSID failure recovery", () => {
  it.each([
    [{ ok: false, status: 0, data: null, networkError: true }, /انقطع الاتصال/],
    [{ ok: false, status: 401, data: null }, /HTTP 401/],
    [{ ok: false, status: 403, data: null }, /HTTP 403/],
    [{ ok: false, status: 502, data: null }, /HTTP 502/],
    [{ ok: false, status: 200, data: null, malformedResponse: true }, /بيانات شهادة الإنتاج غير مكتملة/],
  ])("keeps credentials intact and reports the actual failure", async (response, expected) => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany({ zatcaEnvironment: "simulation" }) as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({ complianceCertEnc: "canonical", complianceCertRawEnc: "raw", complianceSecretEnc: "secret", complianceRequestId: "request-1" } as never);
    vi.mocked(prisma.companyZatcaCredential.update).mockClear();
    vi.mocked(requestProductionCsid).mockResolvedValue(response as never);
    await expect(requestCompanyProductionCsid(TENANT_ID, COMPANY_ID)).rejects.toThrow(expected);
    expect(prisma.companyZatcaCredential.update).not.toHaveBeenCalled();
    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(requestProductionCsid).toHaveBeenLastCalledWith("simulation", { certificateBodyBase64: "canonical", rawCertificateBodyBase64: "raw", secret: "secret" }, "request-1", undefined);
  });
});
