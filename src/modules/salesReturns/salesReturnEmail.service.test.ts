import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesReturn: { findFirst: vi.fn() },
    salesInvoice: { findFirst: vi.fn() },
  },
}));
vi.mock("../../lib/invoicePdf", () => ({ buildPlainCreditNotePdf: vi.fn() }));
vi.mock("../../lib/mailer", () => ({ sendCreditNoteEmail: vi.fn() }));

import { prisma } from "../../lib/prisma";
import { buildPlainCreditNotePdf } from "../../lib/invoicePdf";
import { sendCreditNoteEmail } from "../../lib/mailer";
import { getSalesReturnPdf, sendSalesReturnByEmail } from "./salesReturnEmail.service";

const TENANT_ID = "tenant-1";

afterEach(() => {
  vi.mocked(prisma.salesReturn.findFirst).mockReset();
  vi.mocked(prisma.salesInvoice.findFirst).mockReset();
  vi.mocked(buildPlainCreditNotePdf).mockReset();
  vi.mocked(sendCreditNoteEmail).mockReset();
});

function baseSalesReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: "ret-1",
    returnNumber: "RET-1001",
    date: new Date("2026-02-06"),
    status: "posted",
    reason: "بضاعة تالفة",
    relatedInvoiceId: "inv-1",
    qrPayload: "payload",
    zatcaUuid: "uuid-1",
    subtotal: 100,
    vatTotal: 15,
    grandTotal: 115,
    companyId: "company-1",
    customer: { name: "عميل الاختبار", vatNumber: null, email: "customer@example.com" },
    company: { name: "شركة الاختبار", vatNumber: null, brandColor: null, addressBuilding: null, addressStreet: null, addressCity: null, language: "ar", currency: "SAR" },
    lines: [{ description: "صنف مرتجع", account: { name: "إيرادات مبيعات" }, quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, total: 115 }],
    ...overrides,
  };
}

describe("getSalesReturnPdf — the 'Download PDF' action bar item", () => {
  it("resolves the original invoice's number/date and passes them plus the reason through to buildPlainCreditNotePdf", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(baseSalesReturn() as never);
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ invoiceNumber: "INV-00042", date: new Date("2026-01-15") } as never);
    const fakePdf = Buffer.from("%PDF-fake");
    vi.mocked(buildPlainCreditNotePdf).mockResolvedValue(fakePdf as never);

    const result = await getSalesReturnPdf(TENANT_ID, "ret-1");

    expect(result.buffer).toBe(fakePdf);
    expect(result.fileName).toBe("credit-note-RET-1001.pdf");
    expect(buildPlainCreditNotePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        returnNumber: "RET-1001",
        billingReferenceNumber: "INV-00042",
        billingReferenceDate: "2026-01-15",
        reason: "بضاعة تالفة",
      }),
    );
  });

  it("renders with no billing reference when there is no related invoice (internal credit note)", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(baseSalesReturn({ relatedInvoiceId: null }) as never);
    vi.mocked(buildPlainCreditNotePdf).mockResolvedValue(Buffer.from("%PDF-fake") as never);

    await getSalesReturnPdf(TENANT_ID, "ret-1");

    expect(prisma.salesInvoice.findFirst).not.toHaveBeenCalled();
    expect(buildPlainCreditNotePdf).toHaveBeenCalledWith(
      expect.objectContaining({ billingReferenceNumber: null, billingReferenceDate: null }),
    );
  });

  it("rejects a draft (not yet posted) sales return — no 'official' PDF copy before it's finalized", async () => {
    vi.mocked(buildPlainCreditNotePdf).mockClear();
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(baseSalesReturn({ status: "draft" }) as never);

    await expect(getSalesReturnPdf(TENANT_ID, "ret-1")).rejects.toThrow(/لم يُرحَّل بعد/);
    expect(buildPlainCreditNotePdf).not.toHaveBeenCalled();
  });

  it("throws not-found for a sales return outside this tenant", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(null as never);
    await expect(getSalesReturnPdf(TENANT_ID, "ret-missing")).rejects.toThrow(/غير موجود/);
  });
});

describe("sendSalesReturnByEmail", () => {
  it("sends to the customer's email and reports success", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(baseSalesReturn() as never);
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ invoiceNumber: "INV-00042", date: new Date("2026-01-15") } as never);
    vi.mocked(buildPlainCreditNotePdf).mockResolvedValue(Buffer.from("%PDF-fake") as never);
    vi.mocked(sendCreditNoteEmail).mockResolvedValue(undefined as never);

    const result = await sendSalesReturnByEmail(TENANT_ID, "ret-1");

    expect(result).toEqual({ sent: true });
    expect(sendCreditNoteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "customer@example.com", returnNumber: "RET-1001" }));
  });

  it("reports no_email when the customer has none and no override was given", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(baseSalesReturn({ customer: { name: "عميل", vatNumber: null, email: null } }) as never);

    const result = await sendSalesReturnByEmail(TENANT_ID, "ret-1");
    expect(result).toEqual({ sent: false, reason: "no_email" });
  });

  it("reports send_failed (not throw) when the underlying send fails", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(baseSalesReturn() as never);
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ invoiceNumber: "INV-00042", date: new Date("2026-01-15") } as never);
    vi.mocked(buildPlainCreditNotePdf).mockRejectedValue(new Error("تعذّر توليد PDF"));

    const result = await sendSalesReturnByEmail(TENANT_ID, "ret-1");
    expect(result).toEqual({ sent: false, reason: "send_failed" });
  });

  it("rejects sending for a draft (not yet posted) sales return", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(baseSalesReturn({ status: "draft" }) as never);
    await expect(sendSalesReturnByEmail(TENANT_ID, "ret-1")).rejects.toThrow(/لم يُرحَّل بعد/);
  });
});
