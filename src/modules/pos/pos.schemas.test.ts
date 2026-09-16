import { describe, expect, it } from "vitest";
import { createPosSaleSchema } from "./pos.schemas";

function baseSalePayload(extra: Record<string, unknown> = {}) {
  return {
    companyId: "company-1",
    lines: [{ accountId: "account-1", quantity: 1, unitPrice: 100 }],
    payments: [{ method: "cash", amount: 115 }],
    ...extra,
  };
}

// إعادة إنتاج مباشرة للثغرة التي طُلب إغلاقها: تاريخ إصدار فاتورة نقطة البيع يجب أن يكون وقت
// الخادم الفعلي دائماً بلا أي استثناء — لا حقل "date" قابل للإدخال من العميل بأي شكل إطلاقاً.
describe("createPosSaleSchema — POS issue date can never be client-supplied", () => {
  it("has no 'date' field defined in the schema shape at all", () => {
    expect("date" in createPosSaleSchema._def.schema.shape).toBe(false);
  });

  it("silently strips a client-supplied 'date' instead of accepting or erroring on it", () => {
    const clientSuppliedDate = "2020-01-01T00:00:00.000Z"; // محاولة تأخير واضحة
    const result = createPosSaleSchema.parse(baseSalePayload({ date: clientSuppliedDate }));
    expect(result).not.toHaveProperty("date");
  });

  it("still validates and accepts the rest of the payload normally alongside an ignored 'date'", () => {
    const result = createPosSaleSchema.parse(baseSalePayload({ date: "2020-01-01T00:00:00.000Z" }));
    expect(result.companyId).toBe("company-1");
    expect(result.lines).toHaveLength(1);
  });

  it("keeps supplyDate as a distinct, genuinely accepted optional field (not confused with issue date)", () => {
    const result = createPosSaleSchema.parse(baseSalePayload({ supplyDate: "2026-09-14" }));
    expect(result.supplyDate).toBeInstanceOf(Date);
    expect(result.supplyDate?.toISOString().slice(0, 10)).toBe("2026-09-14");
  });
});
