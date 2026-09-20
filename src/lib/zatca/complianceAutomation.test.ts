import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// اختبار عزل بنيوي: يتتبّع كل استيراد نسبي بدءاً من complianceAutomation.ts فعلياً على القرص (لا
// افتراضاً)، ويفشل فوراً لو أدّى أي مسار — مهما بعُد — إلى أي ملف تحت src/modules (حيث تعيش
// salesInvoices/salesReturns/salesDebitNotes وكل منطق القيود المحاسبية). هذا أقوى من فحص وقت
// التشغيل وحده: يكتشف أي استيراد جديد يُضاف مستقبلاً حتى لو لم يُستدعَ فعلياً في أي اختبار بعد.
function collectRelativeImports(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const importRegex = /(?:import|export)\s+(?:[^"'`]+from\s+)?["'](\.[^"']+)["']/g;
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source))) specifiers.push(match[1]);
  return specifiers;
}

function resolveModuleFile(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function walkImportGraph(entryFile: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entryFile];
  while (queue.length) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const specifier of collectRelativeImports(current)) {
      const resolved = resolveModuleFile(current, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

describe("complianceAutomation — ledger isolation (structural)", () => {
  it("never imports, transitively, from any file under src/modules (where sales/journal writes live)", () => {
    const entry = path.join(__dirname, "complianceAutomation.ts");
    const visited = walkImportGraph(entry);
    const modulesImports = [...visited].filter((f) => f.split(path.sep).includes("modules"));
    expect(modulesImports).toEqual([]);
    // ضمانة إضافية أن الفحص نفسه يعمل فعلياً (لا يمرّ صمتاً بسبب مسار خاطئ) — عدد ملفات حقيقي متوقَّع.
    expect(visited.size).toBeGreaterThan(5);
  });

  it("never imports journalPosting.ts (the shared journal-entry writer) either", () => {
    const entry = path.join(__dirname, "complianceAutomation.ts");
    const visited = walkImportGraph(entry);
    const journalPostingImports = [...visited].filter((f) => path.basename(f) === "journalPosting.ts");
    expect(journalPostingImports).toEqual([]);
  });
});

vi.mock("../prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    companyZatcaCredential: { findUnique: vi.fn() },
    zatcaComplianceStepAttempt: { upsert: vi.fn(), findMany: vi.fn() },
    // عمداً بلا salesInvoice/salesReturn/salesDebitNote/journalEntry إطلاقاً — أي محاولة فعلية
    // لمس أيٍّ منها أثناء تنفيذ runZatcaComplianceStep تُسقِط الاختبار بـTypeError واضح
    // ("Cannot read properties of undefined (reading 'create')")، لا نجاحاً صامتاً يُخفي المشكلة.
  },
}));
vi.mock("./postingGate", () => ({ evaluateZatcaPostingGate: vi.fn() }));

import { prisma } from "../prisma";
import { evaluateZatcaPostingGate } from "./postingGate";
import {
  runZatcaComplianceStep,
  parseMissingComplianceSteps,
  getZatcaComplianceProgress,
  ZATCA_COMPLIANCE_STEPS,
} from "./complianceAutomation";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";

afterEach(() => {
  vi.mocked(prisma.company.findFirst).mockReset();
  vi.mocked(prisma.companyZatcaCredential.findUnique).mockReset();
  vi.mocked(prisma.zatcaComplianceStepAttempt.upsert).mockReset();
  vi.mocked(prisma.zatcaComplianceStepAttempt.findMany).mockReset();
  vi.mocked(evaluateZatcaPostingGate).mockReset();
});

describe("runZatcaComplianceStep — ledger isolation (runtime)", () => {
  it("completes a full run touching only company/companyZatcaCredential/zatcaComplianceStepAttempt — no sales/journal model exists to touch", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY_ID, name: "شركة تجريبية", zatcaOnboardingStatus: "compliance" } as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceRequestId: "req-1", complianceCertEnc: "x", complianceSecretEnc: "y",
    } as never);
    vi.mocked(evaluateZatcaPostingGate).mockResolvedValue({
      proceedWithPosting: true,
      zatcaFields: { zatcaStatus: "compliance_checked", icv: 7, previousInvoiceHash: "prev==", invoiceHash: "hash==" },
    } as never);
    vi.mocked(prisma.zatcaComplianceStepAttempt.upsert).mockResolvedValue({} as never);

    const result = await runZatcaComplianceStep(TENANT_ID, COMPANY_ID, "standard-credit-note-compliant");

    expect(result.passed).toBe(true);
    expect(result.stepKey).toBe("standard-credit-note-compliant");
    // مرجع ذاتي اصطناعي، لا فاتورة حقيقية — نتحقّق من القيمة الفعلية المُمرَّرة لبوابة زاتكا، لا من
    // افتراضها فقط. وBR-KSA-17: سبب الإصدار (issuanceReason) يجب أن يصل أيضاً لمستندات الإشعارات.
    const gateArgs = vi.mocked(evaluateZatcaPostingGate).mock.calls[0][0] as { billingReferenceId?: string; issuanceReason?: string; kind: string };
    expect(gateArgs.kind).toBe("credit_note");
    expect(gateArgs.billingReferenceId).toBeTruthy();
    expect(gateArgs.billingReferenceId).not.toBe("");
    expect(gateArgs.issuanceReason).toBeTruthy();
    // المشتري الاصطناعي يجب أن يُعلن نفسه صراحة كاختبار امتثال، لا اسماً يبدو كعميل حقيقي.
    const customer = (gateArgs as unknown as { customer: { name: string } }).customer;
    expect(customer.name).toMatch(/COMPLIANCE TEST/i);
  });

  it("does not pass an issuanceReason for the invoice-kind step (BR-KSA-17 doesn't apply to invoices)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY_ID, name: "شركة تجريبية", zatcaOnboardingStatus: "compliance" } as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceRequestId: "req-1", complianceCertEnc: "x", complianceSecretEnc: "y",
    } as never);
    vi.mocked(evaluateZatcaPostingGate).mockResolvedValue({
      proceedWithPosting: true,
      zatcaFields: { zatcaStatus: "compliance_checked", icv: 7, previousInvoiceHash: "prev==", invoiceHash: "hash==" },
    } as never);
    vi.mocked(prisma.zatcaComplianceStepAttempt.upsert).mockResolvedValue({} as never);

    await runZatcaComplianceStep(TENANT_ID, COMPANY_ID, "simplified-compliant");
    const gateArgs = vi.mocked(evaluateZatcaPostingGate).mock.calls[0][0] as { billingReferenceId?: string; issuanceReason?: string };
    expect(gateArgs.billingReferenceId).toBeUndefined();
    expect(gateArgs.issuanceReason).toBeUndefined();
  });

  it("rejects synthetic tests after production activation before reserving a chain or sending", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY_ID, zatcaOnboardingStatus: "production" } as never);
    await expect(runZatcaComplianceStep(TENANT_ID, COMPANY_ID, "simplified-compliant")).rejects.toThrow(/مرحلة شهادة الاختبار/);
    expect(evaluateZatcaPostingGate).not.toHaveBeenCalled();
    expect(prisma.zatcaComplianceStepAttempt.upsert).not.toHaveBeenCalled();
  });

  it("enables all six tests, including standard invoices for a new certificate", () => {
    expect(ZATCA_COMPLIANCE_STEPS).toHaveLength(6);
    expect(ZATCA_COMPLIANCE_STEPS.every(s => s.enabled)).toBe(true);
  });

});

describe("parseMissingComplianceSteps", () => {
  it("extracts the exact step list from the real observed message", () => {
    const message =
      '{"code":"Missing-ComplianceSteps","message":"The compliance certificate is not done with the following compliance steps yet [standard-credit-note-compliant,standard-debit-note-compliant,simplified-compliant,simplified-credit-note-compliant,simplified-debit-note-compliant]"}';
    expect(parseMissingComplianceSteps(message)).toEqual([
      "standard-credit-note-compliant",
      "standard-debit-note-compliant",
      "simplified-compliant",
      "simplified-credit-note-compliant",
      "simplified-debit-note-compliant",
    ]);
  });

  it("returns an empty list when there is no bracketed step list at all", () => {
    expect(parseMissingComplianceSteps("some unrelated error")).toEqual([]);
  });
});

describe("getZatcaComplianceProgress", () => {
  it("reports only locally-attempted passes when no ZATCA missing-steps evidence exists yet", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY_ID } as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceRequestId: "req-1", lastMissingComplianceSteps: [], lastComplianceStepsCheckedAt: null,
    } as never);
    vi.mocked(prisma.zatcaComplianceStepAttempt.findMany).mockResolvedValue([
      { stepKey: "standard-credit-note-compliant", passed: true },
    ] as never);

    const progress = await getZatcaComplianceProgress(TENANT_ID, COMPANY_ID);
    expect(progress.steps.find((s) => s.key === "standard-credit-note-compliant")).toEqual({
      key: "standard-credit-note-compliant", passed: true, enabled: true, source: "local_attempt",
    });
    // لا دليل من زاتكا بعد (lastComplianceStepsCheckedAt فارغ) — بقية الخطوات "لم تُختبَر بعد"، لا "ناجزة صمتاً".
    expect(progress.steps.filter((s) => s.source === "zatca_missing_steps_reconciliation")).toEqual([]);
    expect(progress.steps.every((s) => s.key !== "standard-compliant" || s.passed === false)).toBe(true);
    // الشهادة الجديدة يمكنها تشغيل الاختبار القياسي أيضاً.
    expect(progress.steps.find((s) => s.key === "standard-compliant")?.enabled).toBe(true);
    expect(progress.steps.find((s) => s.key === "simplified-compliant")?.enabled).toBe(true);
  });

  it("reconciles a step as passed when ZATCA's own missing-steps list no longer names it", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY_ID } as never);
    vi.mocked(prisma.companyZatcaCredential.findUnique).mockResolvedValue({
      complianceRequestId: "req-1",
      lastMissingComplianceSteps: [
        "standard-credit-note-compliant", "standard-debit-note-compliant",
        "simplified-credit-note-compliant", "simplified-debit-note-compliant", "simplified-compliant",
      ],
      lastComplianceStepsCheckedAt: new Date(),
    } as never);
    vi.mocked(prisma.zatcaComplianceStepAttempt.findMany).mockResolvedValue([] as never);

    const progress = await getZatcaComplianceProgress(TENANT_ID, COMPANY_ID);
    // standard-compliant غائبة عن القائمة المتبقية أعلاه (تطابق الرد الفعلي المُستلَم) — تُحتسَب مُجتازة.
    expect(progress.steps.find((s) => s.key === "standard-compliant")).toEqual({
      key: "standard-compliant", passed: true, enabled: true, source: "zatca_missing_steps_reconciliation",
    });
    expect(progress.steps.find((s) => s.key === "standard-credit-note-compliant")?.passed).toBe(false);
  });

  it("covers all six required document types with no duplicates", () => {
    const keys = ZATCA_COMPLIANCE_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(6);
    expect(keys).toContain("standard-compliant");
    expect(keys).toContain("simplified-debit-note-compliant");
  });
});
