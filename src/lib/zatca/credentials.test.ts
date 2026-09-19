import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../prisma", () => ({ prisma: { companyZatcaCredential: { findUnique: vi.fn() } } }));
// عزل منطق مقارنة البيئة عن التشفير الفعلي — decryptSecret هنا تمرّ القيمة كما هي، فلا حاجة
// لمفتاح تشفير حقيقي أو مغلّف v1:iv:tag:ciphertext فعلي لاختبار هذا المنطق تحديداً.
vi.mock("./secretBox", () => ({ decryptSecret: vi.fn((v: string) => v) }));

import { prisma } from "../prisma";
import { loadCompanyZatcaCredentials, zatcaEnvironmentMismatchMessage } from "./credentials";

afterEach(() => {
  vi.mocked(prisma.companyZatcaCredential.findUnique).mockReset();
});

describe("loadCompanyZatcaCredentials", () => {
  it("returns not_configured when there is no credential row at all", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue(null as never);
    const result = await loadCompanyZatcaCredentials("company-1", "sandbox");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("returns not_configured when no compliance cert/secret exists yet for a non-production environment", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      privateKeyEnc: "key",
      complianceCertEnc: null,
      complianceSecretEnc: null,
      complianceCsidEnvironment: null,
      productionCertEnc: null,
      productionSecretEnc: null,
      productionCsidEnvironment: null,
    } as never);
    const result = await loadCompanyZatcaCredentials("company-1", "sandbox");
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  // الحالة الأصلية قبل هذا التمييز: صف قديم بلا أي تسجيل لبيئة الإصدار — يُفتَرض تطابق البيئة
  // الحالية عمداً (لا إنذار كاذب على ربط قائم يعمل فعلياً اليوم).
  it("treats a legacy row with no recorded issuance environment as matching (no false alarm)", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      privateKeyEnc: "key",
      complianceCertEnc: "cert",
      complianceSecretEnc: "secret",
      complianceCsidEnvironment: null,
      productionCertEnc: null,
      productionSecretEnc: null,
      productionCsidEnvironment: null,
    } as never);
    const result = await loadCompanyZatcaCredentials("company-1", "sandbox");
    // لا عمود rawEnc على هذا الصفّ (سبق إضافته) — الاحتياطي يستخدم الشكل القانوني كما هو، نفس
    // السلوك المعطوب سابقاً على شهادات "مزدوجة الترميز"، إلى أن تُعاد معالجتها.
    expect(result).toEqual({
      ok: true,
      credentials: { certificateBodyBase64: "cert", rawCertificateBodyBase64: "cert", secret: "secret", privateKeyPem: "key" },
    });
  });

  // العمود الجديد (rawEnc) موجود ومختلف عن الشكل القانوني — يجب أن يُستخدَم هو تحديداً، لا الاحتياطي.
  it("prefers the raw certificate column over the canonical one when both are present and differ", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      privateKeyEnc: "key",
      complianceCertEnc: "canonical-cert",
      complianceCertRawEnc: "raw-cert-as-zatca-issued-it",
      complianceSecretEnc: "secret",
      complianceCsidEnvironment: null,
      productionCertEnc: null,
      productionCertRawEnc: null,
      productionSecretEnc: null,
      productionCsidEnvironment: null,
    } as never);
    const result = await loadCompanyZatcaCredentials("company-1", "sandbox");
    expect(result).toEqual({
      ok: true,
      credentials: {
        certificateBodyBase64: "canonical-cert",
        rawCertificateBodyBase64: "raw-cert-as-zatca-issued-it",
        secret: "secret",
        privateKeyPem: "key",
      },
    });
  });

  it("succeeds when the recorded issuance environment matches the requested one", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      privateKeyEnc: "key",
      complianceCertEnc: "cert",
      complianceSecretEnc: "secret",
      complianceCsidEnvironment: "simulation",
      productionCertEnc: null,
      productionSecretEnc: null,
      productionCsidEnvironment: null,
    } as never);
    const result = await loadCompanyZatcaCredentials("company-1", "simulation");
    expect(result.ok).toBe(true);
  });

  // عطل الإنتاج الفعلي المؤكَّد الذي دفع لإضافة هذا الحقل: شهادة اختبار صادرة فعلياً تحت simulation
  // (OTP حقيقي من بوابة فاتورة)، لكن بيئة الشركة الحالية أصبحت/كانت sandbox.
  it("returns environment_mismatch (not ok:true, not not_configured) when the issuance environment differs from the requested one", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      privateKeyEnc: "key",
      complianceCertEnc: "cert",
      complianceSecretEnc: "secret",
      complianceCsidEnvironment: "simulation",
      productionCertEnc: null,
      productionSecretEnc: null,
      productionCsidEnvironment: null,
    } as never);
    const result = await loadCompanyZatcaCredentials("company-1", "sandbox");
    expect(result).toEqual({ ok: false, reason: "environment_mismatch", issuedFor: "simulation" });
  });

  it("checks the production cert/secret/issuance-environment fields, not the compliance ones, when requesting the production environment", async () => {
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      privateKeyEnc: "key",
      complianceCertEnc: "compliance-cert",
      complianceSecretEnc: "compliance-secret",
      complianceCsidEnvironment: "sandbox",
      productionCertEnc: "prod-cert",
      productionSecretEnc: "prod-secret",
      productionCsidEnvironment: "production",
    } as never);
    const result = await loadCompanyZatcaCredentials("company-1", "production");
    expect(result).toEqual({
      ok: true,
      credentials: { certificateBodyBase64: "prod-cert", rawCertificateBodyBase64: "prod-cert", secret: "prod-secret", privateKeyPem: "key" },
    });
  });
});

describe("zatcaEnvironmentMismatchMessage", () => {
  it("names both the issuance environment and the currently-requested one", () => {
    const message = zatcaEnvironmentMismatchMessage("simulation", "sandbox");
    expect(message).toContain("simulation");
    expect(message).toContain("sandbox");
  });
});
