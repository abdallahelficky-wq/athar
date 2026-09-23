import { describe, expect, it } from "vitest";
import { createPosSaleSchema } from "./pos.schemas";
import { computeInvoiceLine } from "../../lib/invoiceLine";

/**
 * الافتراضي الفعلي لـpriceIncludesVat على أي سطر نقطة بيع لا يُحدَّد داخل pos.service.ts، بل في
 * الطلب الحقيقي عبر middleware/validate.ts الذي يستبدل req.body بنتيجة createPosSaleSchema.parse
 * (راجع salesInvoiceLineSchema المشتركة في salesInvoices.schemas.ts: priceIncludesVat: z.boolean().
 * default(true)) — هذا الملف يثبت أن هذا بالضبط ما يحدث فعلياً لطلب نقطة بيع حقيقي، ولا يتغيّر بعد
 * إضافة مفتاح شامل/غير شامل صراحةً في واجهة نقطة البيع (الافتراضي المُختار: true، مطابقاً لنموذج
 * الفاتورة العادية — راجع تقرير الميزة).
 */
describe("createPosSaleSchema — priceIncludesVat default", () => {
  const baseInput = {
    companyId: "co1",
    lines: [{ accountId: "acc1", quantity: 1, unitPrice: 100 }],
    payments: [{ method: "cash", amount: 115 }],
  };

  it("defaults an omitted priceIncludesVat to true, exactly like the regular invoice form", () => {
    const parsed = createPosSaleSchema.parse(baseInput);
    expect(parsed.lines[0].priceIncludesVat).toBe(true);
  });

  it("produces an identical computed line total whether priceIncludesVat is sent explicitly true or omitted entirely", () => {
    const parsedOmitted = createPosSaleSchema.parse(baseInput);
    const parsedExplicit = createPosSaleSchema.parse({
      ...baseInput,
      lines: [{ ...baseInput.lines[0], priceIncludesVat: true }],
    });

    const fromOmitted = computeInvoiceLine(parsedOmitted.lines[0]);
    const fromExplicit = computeInvoiceLine(parsedExplicit.lines[0]);
    expect(fromOmitted).toEqual(fromExplicit);
  });
});
