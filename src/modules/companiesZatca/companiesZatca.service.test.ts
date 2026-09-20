import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(), update: vi.fn() },
    companyZatcaCredential: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (operations) => Promise.all(operations)),
  },
}));

vi.mock("../../lib/zatca/apiClient", () => ({ requestComplianceCsid: vi.fn() }));
vi.mock("../../lib/zatca/secretBox", () => ({ encryptSecret: (value: string) => "encrypted:" + value }));
vi.mock("../../lib/zatca/signing", () => ({ getCertificateInfo: () => ({ canonicalBodyBase64: "canonical" }) }));
import { requestComplianceCsid } from "../../lib/zatca/apiClient";
import { prisma } from "../../lib/prisma";
import { setCompanyZatcaEnvironment, requestCompanyComplianceCsid } from "./companiesZatca.service";

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
  it("still blocks moving to production without an actual production CSID (pre-existing rule, unchanged)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany({ zatcaOnboardingStatus: "compliance" }) as never);

    await expect(setCompanyZatcaEnvironment(TENANT_ID, COMPANY_ID, "production")).rejects.toThrow(/شهادة إنتاج فعلية/);
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
