import { describe, expect, it, vi } from "vitest";

// عطل إنتاج فعلي دفع لهذا الملف: PDF (ومن ثمّ إيميل الفاتورة المرفَق) كان يفشل باستمرار
// (Chromium غير مثبَّت — راجع فرع fix/pdf-chromium-production) بلا أي وسيلة لمعرفة أي الفواتير
// لم يصلها إيميلها إلا بقراءة سجلات الخادم مباشرة. الاختبارات هنا تغطي القائمة الجديدة
// (listInvoicesWithoutSuccessfulEmail) وإعادة الإرسال اليدوية (resendInvoiceEmail) فقط — منطق
// بناء/إرسال الإيميل نفسه (sendInvoiceByEmail) خارج نطاق هذا الملف.
vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesInvoice: { findMany: vi.fn(), findFirst: vi.fn() },
    invoiceEmailLog: { create: vi.fn() },
    companyBankAccount: { findMany: vi.fn() },
  },
}));
vi.mock("../../lib/invoicePdf", () => ({ buildPlainInvoicePdf: vi.fn() }));
vi.mock("../../lib/mailer", () => ({ sendInvoiceEmail: vi.fn() }));

import { prisma } from "../../lib/prisma";
import { buildPlainInvoicePdf } from "../../lib/invoicePdf";
import { sendInvoiceEmail } from "../../lib/mailer";
import { listInvoicesWithoutSuccessfulEmail, resendInvoiceEmail } from "./salesInvoiceEmail.service";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";

describe("listInvoicesWithoutSuccessfulEmail", () => {
  it("queries only posted invoices with no successful email log, and surfaces the last attempt (if any)", async () => {
    vi.mocked(prisma.salesInvoice.findMany).mockResolvedValue([
      {
        id: "inv-1",
        invoiceNumber: "INV-00001",
        date: new Date("2026-01-05"),
        grandTotal: { toString: () => "1150.00" },
        customer: { id: "cust-1", name: "عميل بلا بريد", email: null },
        emailLogs: [],
      },
      {
        id: "inv-2",
        invoiceNumber: "INV-00002",
        date: new Date("2026-01-06"),
        grandTotal: { toString: () => "230.00" },
        customer: { id: "cust-2", name: "عميل فشل إرساله", email: "c2@example.com" },
        emailLogs: [{ createdAt: new Date("2026-01-06T10:00:00Z"), method: "auto", error: "تعذّر توليد PDF" }],
      },
    ] as never);

    const result = await listInvoicesWithoutSuccessfulEmail(TENANT_ID, { companyId: COMPANY_ID });

    expect(prisma.salesInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          companyId: COMPANY_ID,
          status: "posted",
          emailLogs: { none: { success: true } },
        }),
      }),
    );

    expect(result).toEqual([
      {
        id: "inv-1", invoiceNumber: "INV-00001", date: new Date("2026-01-05"), grandTotal: "1150.00",
        customerId: "cust-1", customerName: "عميل بلا بريد", customerEmail: null, lastAttempt: null,
      },
      {
        id: "inv-2", invoiceNumber: "INV-00002", date: new Date("2026-01-06"), grandTotal: "230.00",
        customerId: "cust-2", customerName: "عميل فشل إرساله", customerEmail: "c2@example.com",
        lastAttempt: { at: new Date("2026-01-06T10:00:00Z"), method: "auto", reason: "تعذّر توليد PDF" },
      },
    ]);
  });

  it("returns an empty list when every posted invoice already has a successful email", async () => {
    vi.mocked(prisma.salesInvoice.findMany).mockResolvedValue([] as never);
    const result = await listInvoicesWithoutSuccessfulEmail(TENANT_ID, {});
    expect(result).toEqual([]);
  });
});

describe("resendInvoiceEmail — manual only, never automatic", () => {
  it("delegates to the same send logic as the regular manual resend endpoint, tagged method: manual", async () => {
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({
      id: "inv-1", status: "posted", customerId: "cust-1", companyId: COMPANY_ID,
      customer: { email: "customer@example.com", name: "عميل" }, company: { language: "ar", currency: "SAR" },
      lines: [], receiptAllocations: [], grandTotal: 115,
    } as never);
    vi.mocked(prisma.companyBankAccount.findMany).mockResolvedValue([] as never);
    vi.mocked(buildPlainInvoicePdf).mockResolvedValue(Buffer.from("%PDF-fake") as never);
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined as never);
    vi.mocked(prisma.invoiceEmailLog.create).mockResolvedValue({} as never);

    const result = await resendInvoiceEmail(TENANT_ID, "inv-1");

    expect(result).toEqual({ sent: true });
    expect(prisma.invoiceEmailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ method: "manual", success: true }) }),
    );
    // لا استدعاء تلقائي أو مجدول من أي نوع — الدالة نفسها لا تُستدعى إلا حين يستدعيها الكود صراحةً؛
    // هذا الاختبار يثبت أن الاستدعاء الوحيد الذي حدث هنا هو الاستدعاء الصريح أعلاه (مرة واحدة).
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  it("records the failure (invoice id, time via createdAt default, reason) when the resend attempt itself fails", async () => {
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({
      id: "inv-1", status: "posted", customerId: "cust-1", companyId: COMPANY_ID,
      customer: { email: "customer@example.com", name: "عميل" }, company: { language: "ar", currency: "SAR" },
      lines: [], receiptAllocations: [], grandTotal: 115,
    } as never);
    vi.mocked(prisma.companyBankAccount.findMany).mockResolvedValue([] as never);
    vi.mocked(buildPlainInvoicePdf).mockRejectedValue(new Error("تعذّر توليد PDF"));
    vi.mocked(prisma.invoiceEmailLog.create).mockResolvedValue({} as never);

    const result = await resendInvoiceEmail(TENANT_ID, "inv-1");

    expect(result).toEqual({ sent: false, reason: "send_failed" });
    expect(prisma.invoiceEmailLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID, invoiceId: "inv-1", method: "manual", success: false, error: "تعذّر توليد PDF",
      }),
    });
  });
});
