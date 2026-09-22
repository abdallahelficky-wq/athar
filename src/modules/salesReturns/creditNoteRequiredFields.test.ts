import { afterEach, describe, expect, it, vi } from "vitest";

// اختبارات قيد "الفاتورة الأصلية وسبب الإصدار إلزاميان لشركة مرتبطة بزاتكا" — راجع
// assertCreditNoteRequiredFieldsForOnboardedCompany في salesReturns.service.ts. مُموَّهة بالكامل
// (لا اتصال بقاعدة بيانات حقيقية ولا بزاتكا)؛ الهدف اختبار الفحص نفسه فقط، لا مسار الترحيل الكامل
// (ذلك مغطّى في salesReturns.postingPipeline.test.ts).
vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesInvoice: { findFirst: vi.fn() },
    company: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    customer: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
    salesReturn: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/zatca/chain", () => ({ reserveZatcaChain: vi.fn(), rebuildZatcaDocumentXml: vi.fn() }));
vi.mock("../../lib/zatca/postingGate", () => ({ submitZatcaChainDocument: vi.fn() }));
vi.mock("../../lib/docNumbering", () => ({ reserveDocumentNumber: vi.fn() }));
vi.mock("../../lib/journalPosting", () => ({
  createJournalEntryTx: vi.fn(),
  deleteJournalEntryTx: vi.fn(),
  assertValidUnlockPin: vi.fn(),
  writeUnpostAuditLogTx: vi.fn(),
}));
vi.mock("../../lib/wellKnownAccounts", () => ({ getAccountIdByName: vi.fn() }));
vi.mock("../../lib/partyAccounts", () => ({ resolvePartyAccountId: vi.fn() }));

import { prisma } from "../../lib/prisma";
import { createSalesReturn, postSalesReturn } from "./salesReturns.service";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";
const CUSTOMER_ID = "customer-1";
const ACCOUNT_ID = "revenue-account-1";
const RELATED_INVOICE_ID = "invoice-1";

const CUSTOMER_ROW = { id: CUSTOMER_ID, tenantId: TENANT_ID, companyId: COMPANY_ID, customerType: "business", vatNumber: "300000000000010", name: "عميل تجريبي", accountId: null };

function companyRow(zatcaOnboardingStatus: "not_onboarded" | "compliance" | "production") {
  return { id: COMPANY_ID, tenantId: TENANT_ID, name: "شركة تجريبية", vatNumber: "300000000000003", zatcaOnboardingStatus };
}

function returnInput(overrides: Partial<{ relatedInvoiceId?: string; reason?: string }> = {}) {
  return {
    companyId: COMPANY_ID,
    customerId: CUSTOMER_ID,
    date: new Date("2026-01-01"),
    refundMethod: "account" as const,
    lines: [{ accountId: ACCOUNT_ID, quantity: 1, unitPrice: 100, priceIncludesVat: false }],
    ...overrides,
  };
}

afterEach(() => {
  vi.mocked(prisma.company.findFirst).mockReset();
  vi.mocked(prisma.company.findFirstOrThrow).mockReset();
  vi.mocked(prisma.customer.findFirst).mockReset();
  vi.mocked(prisma.account.findMany).mockReset();
  vi.mocked(prisma.salesReturn.findFirst).mockReset();
});

describe("createSalesReturn — original invoice + reason required for a ZATCA-onboarded company", () => {
  it.each(["compliance", "production"] as const)(
    "rejects a return with no relatedInvoiceId when the company is %s",
    async (status) => {
      vi.mocked(prisma.company.findFirst).mockResolvedValue(companyRow(status) as never);
      vi.mocked(prisma.customer.findFirst).mockResolvedValue(CUSTOMER_ROW as never);

      await expect(createSalesReturn(TENANT_ID, "user-1", returnInput({ reason: "بضاعة تالفة" }))).rejects.toThrow(
        /الفاتورة الأصلية وسبب الإصدار إلزاميان/,
      );
    },
  );

  it.each(["compliance", "production"] as const)("rejects a return with no reason when the company is %s", async (status) => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(companyRow(status) as never);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(CUSTOMER_ROW as never);

    await expect(createSalesReturn(TENANT_ID, "user-1", returnInput({ relatedInvoiceId: RELATED_INVOICE_ID }))).rejects.toThrow(
      /الفاتورة الأصلية وسبب الإصدار إلزاميان/,
    );
  });

  it("rejects a return with neither relatedInvoiceId nor reason when the company is onboarded", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(companyRow("production") as never);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(CUSTOMER_ROW as never);

    await expect(createSalesReturn(TENANT_ID, "user-1", returnInput())).rejects.toThrow(/الفاتورة الأصلية وسبب الإصدار إلزاميان/);
  });

  it("allows a return with no relatedInvoiceId/reason when the company is NOT onboarded (legitimate internal-only reversal)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue(companyRow("not_onboarded") as never);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(CUSTOMER_ROW as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue([{ id: ACCOUNT_ID }] as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) =>
      fn({
        $queryRaw: vi.fn(),
        salesInvoice: { findFirst: vi.fn() },
        salesReturn: {
          create: vi.fn().mockResolvedValue({ id: "return-1", returnNumber: "RET-00001", status: "posted", lines: [] }),
        },
        journalEntry: { update: vi.fn() },
      })) as never);

    const { createJournalEntryTx } = await import("../../lib/journalPosting");
    vi.mocked(createJournalEntryTx).mockResolvedValue({ id: "journal-1" } as never);
    const { getAccountIdByName } = await import("../../lib/wellKnownAccounts");
    vi.mocked(getAccountIdByName).mockResolvedValue("vat-output-account");
    const { resolvePartyAccountId } = await import("../../lib/partyAccounts");
    vi.mocked(resolvePartyAccountId).mockResolvedValue("receivable-account");
    const { reserveDocumentNumber } = await import("../../lib/docNumbering");
    vi.mocked(reserveDocumentNumber).mockResolvedValue("RET-00001");

    await expect(createSalesReturn(TENANT_ID, "user-1", returnInput())).resolves.toMatchObject({ status: "posted" });
  });
});

describe("postSalesReturn — re-checks the same requirement at posting time", () => {
  it("rejects posting a draft return with no relatedInvoiceId/reason if the company became ZATCA-onboarded since it was created as a draft", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue({
      id: "return-1",
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      status: "draft",
      relatedInvoiceId: null,
      reason: null,
      refundMethod: "account",
      returnNumber: "RET-00001",
      grandTotal: 115,
      vatTotal: 15,
      zatcaUuid: "uuid-1",
      date: new Date("2026-01-01"),
      customer: CUSTOMER_ROW,
      lines: [{ accountId: ACCOUNT_ID, quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, total: 115, priceIncludesVat: false, vatApplicable: true, taxCategoryCode: "S" }],
    } as never);
    vi.mocked(prisma.company.findFirstOrThrow).mockResolvedValue(companyRow("production") as never);

    await expect(postSalesReturn(TENANT_ID, "user-1", "return-1")).rejects.toThrow(/الفاتورة الأصلية وسبب الإصدار إلزاميان/);
  });
});
