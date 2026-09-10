import { describe, expect, it } from "vitest";
import { computeSettlementAdjustment } from "./periodicSettlement.service";

describe("computeSettlementAdjustment", () => {
  it("recognizes ending inventory value on the very first settlement (opening balance 0)", () => {
    // مثال دورة 1 من التحليل: افتتاحي=0، معدود=300 (بتكلفة 1 للوحدة)، متتبَّع تشغيلياً=300 (يطابق تماماً)
    const adj = computeSettlementAdjustment(0, 300, 1, 300);
    expect(adj.closingValue).toBe(300);
    expect(adj.netAdjustment).toBe(300);
    expect(adj.debitLeg).toBe("stock"); // مدين المخزون (اكتسب قيمة)
    expect(adj.needsJournalEntry).toBe(true);
    expect(adj.quantityVariance).toBe(0);
    expect(adj.needsStockMovement).toBe(false);
  });

  it("matches the two-cycle worked example from the design doc exactly (COGS = opening + purchases − ending)", () => {
    // الدورة 2: افتتاحي=300 (من الدورة 1)، معدود=200 (تكلفة 1)، متتبَّع تشغيلياً=200
    const adj = computeSettlementAdjustment(300, 200, 1, 200);
    expect(adj.closingValue).toBe(200);
    expect(adj.netAdjustment).toBe(-100);
    expect(adj.debitLeg).toBe("purchases"); // جزء أكبر أصبح تكلفة بضاعة مباعة فعلية
    expect(adj.needsJournalEntry).toBe(true);
  });

  it("creates no journal entry when the net adjustment is within epsilon (no real change)", () => {
    const adj = computeSettlementAdjustment(300, 300, 1, 300);
    expect(adj.netAdjustment).toBe(0);
    expect(adj.needsJournalEntry).toBe(false);
    expect(adj.debitLeg).toBeNull();
  });

  it("is idempotent: re-running the exact same settlement twice produces no adjustment the second time", () => {
    const first = computeSettlementAdjustment(0, 300, 1, 300);
    // بعد التسوية الأولى: periodicStockValue يصبح 300، والكمية المتتبَّعة تشمل حركة adjustment فأصبحت 300
    const second = computeSettlementAdjustment(first.closingValue, 300, 1, 300);
    expect(second.needsJournalEntry).toBe(false);
    expect(second.needsStockMovement).toBe(false);
  });

  it("records a positive quantity variance (found more than tracked — undocumented inbound) without needing a journal entry by itself", () => {
    const adj = computeSettlementAdjustment(300, 320, 1, 300);
    expect(adj.quantityVariance).toBe(20);
    expect(adj.needsStockMovement).toBe(true);
    // القيمة تغيّرت أيضاً هنا (320 مقابل 300) فيُنشأ قيد أيضاً بالضرورة في هذه الحالة تحديداً
    expect(adj.needsJournalEntry).toBe(true);
  });

  it("records a negative quantity variance (shrinkage/loss not captured by any invoice)", () => {
    const adj = computeSettlementAdjustment(300, 280, 1, 300);
    expect(adj.quantityVariance).toBe(-20);
    expect(adj.needsStockMovement).toBe(true);
  });

  it("handles quantity variance with unchanged total value (e.g. cost per unit dropped exactly offsetting fewer units)", () => {
    // معدود أقل لكن بتكلفة أعلى تعطي نفس القيمة الإجمالية بالضبط — لا قيد مطلوب رغم فرق الكمية
    const adj = computeSettlementAdjustment(300, 250, 1.2, 300);
    expect(adj.closingValue).toBe(300);
    expect(adj.needsJournalEntry).toBe(false);
    expect(adj.quantityVariance).toBe(-50);
    expect(adj.needsStockMovement).toBe(true);
  });

  it("treats a brand new zero-count item correctly (fully sold out / never stocked)", () => {
    const adj = computeSettlementAdjustment(300, 0, 0, 300);
    expect(adj.closingValue).toBe(0);
    expect(adj.netAdjustment).toBe(-300);
    expect(adj.debitLeg).toBe("purchases");
    expect(adj.quantityVariance).toBe(-300);
  });
});
