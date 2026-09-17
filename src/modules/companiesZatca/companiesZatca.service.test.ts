import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(), update: vi.fn() },
    companyZatcaCredential: { findUnique: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";
import { setCompanyZatcaEnvironment } from "./companiesZatca.service";

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
