import { afterEach, describe, expect, it, vi } from "vitest";

// يغطي قيد "التعديل للمسودة فقط" على مستوى الخادم — نفس تبرير invoiceEditGuard.test.ts بالضبط:
// شريط إجراءات شاشة عرض إشعار الدائن يُظهر زر "تعديل" فقط لمسودة، لكن الواجهة وحدها لا تكفي؛
// هذا الاختبار يثبت أن الخادم يرفض التعديل أيضاً لأي مردود غير مسودة، بصرف النظر عمّا ترسله الواجهة.
vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesReturn: { findFirst: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";
import { updateSalesReturn } from "./salesReturns.service";

const TENANT_ID = "tenant-1";

afterEach(() => {
  vi.mocked(prisma.salesReturn.findFirst).mockReset();
});

describe("updateSalesReturn — draft only", () => {
  it.each(["posted", "pending_submission", "zatca_accepted_posting_incomplete"] as const)(
    "rejects updating a sales return with status %s",
    async (status) => {
      vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue({ id: "ret-1", tenantId: TENANT_ID, status } as never);

      await expect(
        updateSalesReturn(TENANT_ID, "ret-1", {
          companyId: "company-1",
          customerId: "customer-1",
          date: new Date("2026-01-01"),
          refundMethod: "account",
          lines: [{ accountId: "account-1", quantity: 1, unitPrice: 100 }],
        } as never),
      ).rejects.toThrow(/لا يمكن تعديل مردود مرحّل/);
    },
  );

  it("throws not-found for a sales return outside this tenant", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(null as never);
    await expect(
      updateSalesReturn(TENANT_ID, "ret-missing", {
        companyId: "company-1",
        customerId: "customer-1",
        date: new Date("2026-01-01"),
        refundMethod: "account",
        lines: [{ accountId: "account-1", quantity: 1, unitPrice: 100 }],
      } as never),
    ).rejects.toThrow(/غير موجود/);
  });
});
