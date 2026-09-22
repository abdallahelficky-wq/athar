import { afterEach, describe, expect, it, vi } from "vitest";

// يغطي أن getSalesReturn — المُستخدَمة في شاشة عرض إشعار الدائن الجديدة — (أ) تجلب الفاتورة
// الأصلية (رقمها/تاريخها/إجماليها) فعلياً لو كان المردود مرتبطاً بها، وتتجاهل الجلب تماماً لو لم
// يكن، و(ب) تشتق itemId لكل سطر من سطر الفاتورة الأصلية المطابق (originalInvoiceLineId) — راجع
// تعليق الدالة نفسها: SalesReturnLine لا يحمل itemId إطلاقاً خلافاً لـSalesInvoiceLine.
vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesReturn: { findFirst: vi.fn() },
    salesInvoice: { findFirst: vi.fn() },
    salesInvoiceLine: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";
import { getSalesReturn } from "./salesReturns.service";

const TENANT_ID = "tenant-1";

afterEach(() => {
  vi.mocked(prisma.salesReturn.findFirst).mockReset();
  vi.mocked(prisma.salesInvoice.findFirst).mockReset();
  vi.mocked(prisma.salesInvoiceLine.findMany).mockReset();
});

describe("getSalesReturn", () => {
  it("attaches the related invoice's number/date/grandTotal when relatedInvoiceId is set", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue({ id: "ret-1", tenantId: TENANT_ID, relatedInvoiceId: "inv-1", lines: [] } as never);
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ id: "inv-1", invoiceNumber: "INV-00042", date: new Date("2026-01-15"), grandTotal: 1150 } as never);
    vi.mocked(prisma.salesInvoiceLine.findMany).mockResolvedValue([] as never);

    const result = await getSalesReturn(TENANT_ID, "ret-1");

    expect(result.relatedInvoice).toEqual({ id: "inv-1", invoiceNumber: "INV-00042", date: new Date("2026-01-15"), grandTotal: 1150 });
    expect(prisma.salesInvoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1", tenantId: TENANT_ID } }),
    );
  });

  it("does not fetch or attach a related invoice when relatedInvoiceId is absent", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue({ id: "ret-1", tenantId: TENANT_ID, relatedInvoiceId: null, lines: [] } as never);

    const result = await getSalesReturn(TENANT_ID, "ret-1");

    expect(result.relatedInvoice).toBeNull();
    expect(prisma.salesInvoice.findFirst).not.toHaveBeenCalled();
    expect(prisma.salesInvoiceLine.findMany).not.toHaveBeenCalled();
  });

  it("throws not-found for a sales return outside this tenant", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue(null as never);
    await expect(getSalesReturn(TENANT_ID, "ret-missing")).rejects.toThrow(/غير موجود/);
  });

  it("derives each line's itemId from the matching original invoice line, and null for lines with no match", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue({
      id: "ret-1", tenantId: TENANT_ID, relatedInvoiceId: "inv-1",
      lines: [
        { id: "rl-1", originalInvoiceLineId: "il-1" },
        { id: "rl-2", originalInvoiceLineId: "il-2" },
        { id: "rl-3", originalInvoiceLineId: null },
      ],
    } as never);
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ id: "inv-1", invoiceNumber: "INV-1", date: new Date("2026-01-01"), grandTotal: 100 } as never);
    vi.mocked(prisma.salesInvoiceLine.findMany).mockResolvedValue([
      { id: "il-1", itemId: "item-1" },
      { id: "il-2", itemId: null },
    ] as never);

    const result = await getSalesReturn(TENANT_ID, "ret-1");

    expect(result.lines.map((l) => l.itemId)).toEqual(["item-1", null, null]);
  });

  it("gives every line a null itemId when the sales return has no related invoice", async () => {
    vi.mocked(prisma.salesReturn.findFirst).mockResolvedValue({
      id: "ret-1", tenantId: TENANT_ID, relatedInvoiceId: null,
      lines: [{ id: "rl-1", originalInvoiceLineId: null }],
    } as never);

    const result = await getSalesReturn(TENANT_ID, "ret-1");

    expect(result.lines.map((l) => l.itemId)).toEqual([null]);
  });
});
