import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// المُنسِّق لا يبني أي مُخرَج زاتكا بنفسه (XML/توقيع/شهادة) — كل ذلك في الدوال التي يستدعيها ومُختبَر في
// ملفاتها. هنا نختبر الترتيب والاستئناف والحراسة فقط، فتُستبدَل تلك الدوال بمحاكيات. ما يُصنَع يدوياً
// هنا هو نتائج تأتي من الخارج فعلاً (قبول/رفض زاتكا لكل اختبار).

vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    companyZatcaCredential: { findUnique: vi.fn() },
  },
}));
vi.mock("./companiesZatca.service", () => ({
  generateCompanyCsr: vi.fn(),
  requestCompanyComplianceCsid: vi.fn(),
  requestCompanyProductionCsid: vi.fn(),
  setCompanyZatcaEnvironment: vi.fn(),
  getZatcaStatus: vi.fn(async () => ({ onboardingStatus: "production" })),
}));
vi.mock("../../lib/zatca/complianceAutomation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/zatca/complianceAutomation")>();
  return { ...actual, runZatcaComplianceStep: vi.fn(), getZatcaComplianceProgress: vi.fn() };
});

import { prisma } from "../../lib/prisma";
import {
  generateCompanyCsr,
  requestCompanyComplianceCsid,
  requestCompanyProductionCsid,
  setCompanyZatcaEnvironment,
} from "./companiesZatca.service";
import { runZatcaComplianceStep, getZatcaComplianceProgress, ZATCA_COMPLIANCE_STEPS } from "../../lib/zatca/complianceAutomation";
import { onboardCompanyZatcaOneStep, findMissingCompanyFields, applicableComplianceStepKeys } from "./zatcaOneStepOnboarding";

const T = "tenant-1";
const C = "company-1";
const ALL_KEYS = ZATCA_COMPLIANCE_STEPS.map((s) => s.key);

const completeCompany = {
  id: C,
  tenantId: T,
  name: "شركة تجربة",
  vatNumber: "300000000000003",
  crNumber: "4030000000",
  addressStreet: "شارع التحلية",
  addressBuilding: "1234",
  addressDistrict: "الروضة",
  addressCity: "جدة",
  addressPostalCode: "23435",
  zatcaOnboardingStatus: "not_onboarded",
  zatcaEnvironment: "production",
};

const usableComplianceCredential = {
  complianceRequestId: "req-1",
  complianceCertEnc: "c",
  complianceSecretEnc: "s",
  complianceCsidEnvironment: "production",
  csrInvoiceType: "both",
  lastMissingComplianceSteps: [],
  lastComplianceStepsCheckedAt: null,
};

function progress(passedKeys: string[]) {
  return {
    complianceRequestId: "req-1",
    steps: ALL_KEYS.map((key) => ({ key, passed: passedKeys.includes(key), enabled: true, source: "local_attempt" })),
  };
}

async function catchErr(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { message: string; status: number; details: Record<string, unknown> };
  }
  throw new Error("expected rejection");
}

beforeEach(() => {
  vi.mocked(prisma.company.findFirst).mockResolvedValue(completeCompany as never);
  vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({ ...usableComplianceCredential, csrInvoiceType: "both" } as never);
  vi.mocked(getZatcaComplianceProgress).mockResolvedValue(progress([]) as never);
  vi.mocked(runZatcaComplianceStep).mockImplementation(async (_t, _c, key) => ({ stepKey: key, passed: true, zatcaStatus: "compliance_checked" }) as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("findMissingCompanyFields", () => {
  it("accepts complete company data", () => {
    expect(findMissingCompanyFields(completeCompany)).toEqual([]);
  });

  it("flags missing and malformed fields", () => {
    expect(
      findMissingCompanyFields({ ...completeCompany, vatNumber: "123", addressBuilding: "12", addressPostalCode: null, crNumber: " " }),
    ).toEqual(["vatNumber", "crNumber", "addressBuilding", "addressPostalCode"]);
  });
});

describe("applicableComplianceStepKeys", () => {
  it("limits steps to the CSR invoice type", () => {
    expect(applicableComplianceStepKeys("standard")).toEqual(["standard-compliant", "standard-credit-note-compliant", "standard-debit-note-compliant"]);
    expect(applicableComplianceStepKeys("simplified")).toHaveLength(3);
    expect(applicableComplianceStepKeys(null)).toEqual(ALL_KEYS);
  });
});

describe("onboardCompanyZatcaOneStep", () => {
  it("runs the whole flow from a single OTP: CSR, compliance CSID, all six checks in order, then production", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(usableComplianceCredential as never);

    const result = await onboardCompanyZatcaOneStep(T, C, { otp: "123456" });

    expect(generateCompanyCsr).toHaveBeenCalledWith(T, C, { invoiceType: "both" });
    expect(requestCompanyComplianceCsid).toHaveBeenCalledWith(T, C, "123456");
    expect(vi.mocked(runZatcaComplianceStep).mock.calls.map((c) => c[2])).toEqual(ALL_KEYS);
    expect(requestCompanyProductionCsid).toHaveBeenCalledTimes(1);
    expect(result.stages.map((s) => s.status)).toEqual(["done", "done", "done", "done"]);
  });

  it("stops before touching ZATCA when company data is incomplete, so the OTP is not consumed", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, addressPostalCode: "" } as never);

    const err = await catchErr(onboardCompanyZatcaOneStep(T, C, { otp: "123456" }));

    expect(err.details.missingFields).toEqual(["addressPostalCode"]);
    expect(err.details.failedStage).toBe("validate");
    expect(generateCompanyCsr).not.toHaveBeenCalled();
    expect(requestCompanyComplianceCsid).not.toHaveBeenCalled();
  });

  it("rejects a malformed OTP before generating a new CSR", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue(null as never);
    await catchErr(onboardCompanyZatcaOneStep(T, C, { otp: "12ab" }));
    expect(generateCompanyCsr).not.toHaveBeenCalled();
  });

  it("maps an OTP rejection to a plain message and keeps ZATCA's text as technical detail", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue(null as never);
    vi.mocked(requestCompanyComplianceCsid).mockRejectedValueOnce(new Error('رفضت زاتكا طلب شهادة الاختبار: {"errorCode":"Invalid-OTP"}'));

    const err = await catchErr(onboardCompanyZatcaOneStep(T, C, { otp: "123456" }));

    expect(err.message).toContain("رمز OTP غير صحيح");
    expect(err.details.technical).toContain("Invalid-OTP");
    expect(runZatcaComplianceStep).not.toHaveBeenCalled();
  });

  it("resumes without an OTP and runs only the checks not yet passed", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, zatcaOnboardingStatus: "compliance" } as never);
    vi.mocked(getZatcaComplianceProgress).mockResolvedValue(progress(ALL_KEYS.slice(0, 4)) as never);

    const result = await onboardCompanyZatcaOneStep(T, C, {});

    expect(generateCompanyCsr).not.toHaveBeenCalled();
    expect(requestCompanyComplianceCsid).not.toHaveBeenCalled();
    expect(vi.mocked(runZatcaComplianceStep).mock.calls.map((c) => c[2])).toEqual(ALL_KEYS.slice(4));
    expect(result.stages.find((s) => s.key === "certificate")?.status).toBe("skipped");
    expect(requestCompanyProductionCsid).toHaveBeenCalledTimes(1);
  });

  it("re-runs a locally passed check that ZATCA still lists as missing", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, zatcaOnboardingStatus: "compliance" } as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      ...usableComplianceCredential,
      lastMissingComplianceSteps: ["simplified-compliant"],
      lastComplianceStepsCheckedAt: new Date(),
    } as never);
    vi.mocked(getZatcaComplianceProgress).mockResolvedValue(progress(ALL_KEYS) as never);

    await onboardCompanyZatcaOneStep(T, C, {});

    expect(vi.mocked(runZatcaComplianceStep).mock.calls.map((c) => c[2])).toEqual(["simplified-compliant"]);
  });

  it("stops at the first failed check and never requests the production certificate", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, zatcaOnboardingStatus: "compliance" } as never);
    vi.mocked(runZatcaComplianceStep)
      .mockResolvedValueOnce({ stepKey: ALL_KEYS[0], passed: true, zatcaStatus: "compliance_checked" } as never)
      .mockResolvedValueOnce({ stepKey: ALL_KEYS[1], passed: false, zatcaStatus: "rejected", rejectionReason: "BR-KSA-XX" } as never);

    const err = await catchErr(onboardCompanyZatcaOneStep(T, C, {}));

    expect(err.details.failedStage).toBe("complianceChecks");
    expect(err.details.failedStep).toBe(ALL_KEYS[1]);
    expect(runZatcaComplianceStep).toHaveBeenCalledTimes(2);
    expect(requestCompanyProductionCsid).not.toHaveBeenCalled();
  });

  it("does not retry the production request automatically when all checks had already passed", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, zatcaOnboardingStatus: "compliance" } as never);
    vi.mocked(getZatcaComplianceProgress).mockResolvedValue(progress(ALL_KEYS) as never);

    const err = await catchErr(onboardCompanyZatcaOneStep(T, C, {}));

    expect(err.details.failedStage).toBe("activation");
    expect(requestCompanyProductionCsid).not.toHaveBeenCalled();
  });

  it("refuses to switch environment over an unfinished link on another environment", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, zatcaOnboardingStatus: "compliance" } as never);

    await catchErr(onboardCompanyZatcaOneStep(T, C, { environment: "simulation", otp: "123456" }));

    expect(setCompanyZatcaEnvironment).not.toHaveBeenCalled();
    expect(generateCompanyCsr).not.toHaveBeenCalled();
  });

  it("refuses an already linked company", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, zatcaOnboardingStatus: "production" } as never);
    const err = await catchErr(onboardCompanyZatcaOneStep(T, C, { otp: "123456" }));
    expect(err.status).toBe(409);
  });

  it("rejects a second concurrent run for the same company", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ ...completeCompany, zatcaOnboardingStatus: "compliance" } as never);
    let release!: () => void;
    vi.mocked(runZatcaComplianceStep).mockImplementationOnce(
      () => new Promise((r) => { release = () => r({ stepKey: ALL_KEYS[0], passed: true, zatcaStatus: "compliance_checked" } as never); }),
    );

    const first = onboardCompanyZatcaOneStep(T, C, {});
    await new Promise((r) => setTimeout(r, 0));
    const second = await catchErr(onboardCompanyZatcaOneStep(T, C, {}));
    expect(second.status).toBe(409);
    release();
    await first;
  });
});
