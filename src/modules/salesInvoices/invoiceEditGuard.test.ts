import { afterEach, describe, expect, it, vi } from "vitest";

// يغطي قيد "التعديل للمسودة فقط" على مستوى الخادم — راجع شريط إجراءات شاشة عرض الفاتورة
// (InvoiceViewModal.jsx): زر "تعديل" يظهر فقط لمسودة (raجع onEdit المشروط بـstatus==="draft")،
// لكن الواجهة وحدها لا تكفي؛ هذا الاختبار يثبت أن الخادم يرفض التعديل أيضاً لأي فاتورة غير مسودة،
// بصرف النظر عمّا ترسله الواجهة.
vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesInvoice: { findFirst: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";
import { updateSalesInvoice } from "./salesInvoices.service";

const TENANT_ID = "tenant-1";

afterEach(() => {
  vi.mocked(prisma.salesInvoice.findFirst).mockReset();
});

describe("updateSalesInvoice — draft only", () => {
  it.each(["posted", "pending_submission", "zatca_accepted_posting_incomplete"] as const)(
    "rejects updating an invoice with status %s",
    async (status) => {
      vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ id: "inv-1", tenantId: TENANT_ID, status } as never);

      await expect(
        updateSalesInvoice(TENANT_ID, "inv-1", {
          companyId: "company-1",
          customerId: "customer-1",
          date: new Date("2026-01-01"),
          lines: [{ accountId: "account-1", quantity: 1, unitPrice: 100 }],
        } as never),
      ).rejects.toThrow(/لا يمكن تعديل فاتورة مرحّلة/);
    },
  );

  it("throws not-found for an invoice outside this tenant", async () => {
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue(null as never);
    await expect(
      updateSalesInvoice(TENANT_ID, "inv-missing", {
        companyId: "company-1",
        customerId: "customer-1",
        date: new Date("2026-01-01"),
        lines: [{ accountId: "account-1", quantity: 1, unitPrice: 100 }],
      } as never),
    ).rejects.toThrow(/غير موجودة/);
  });
});
