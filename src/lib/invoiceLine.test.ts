import { describe, expect, it } from "vitest";
import { computeInvoiceLine } from "./invoiceLine";

describe("computeInvoiceLine", () => {
  // هذا بالضبط المثال الذي كسر BR-CO-15 فعلياً: 105.00 شامل الضريبة عند 15% ينتج حسابياً
  // 91.304347...+13.695652...، وكان التقريب/البتر السابق يكتب 13.69 (بدل 13.70) في XML — فيصبح
  // 91.30 + 13.69 = 104.99 ≠ 105.00 المصرَّح بها. بعد التقريب هنا: 13.70 + 91.30 = 105.00 تماماً.
  it("rounds VAT-inclusive VAT half-away-from-zero and derives net so components reconcile exactly", () => {
    const { subtotal, vat, total } = computeInvoiceLine({ quantity: 1, unitPrice: 105, priceIncludesVat: true });
    expect(vat).toBe(13.7);
    expect(subtotal).toBe(91.3);
    expect(total).toBe(105);
    expect(subtotal + vat).toBe(total);
  });

  it("rounds VAT-exclusive VAT to 2 decimals and total is the sum of the rounded parts", () => {
    // 33.33 * 0.15 = 4.9995 — يجب أن تُقرَّب لأعلى إلى 5.00 (نصف بعيد عن الصفر)، لا تُبتَر لـ4.99.
    const { subtotal, vat, total } = computeInvoiceLine({ quantity: 1, unitPrice: 33.33, priceIncludesVat: false });
    expect(subtotal).toBe(33.33);
    expect(vat).toBe(5);
    expect(total).toBe(38.33);
  });

  it("never adds VAT when vatApplicable is false, regardless of priceIncludesVat", () => {
    const included = computeInvoiceLine({ quantity: 1, unitPrice: 100, priceIncludesVat: true, vatApplicable: false });
    expect(included).toEqual({ subtotal: 100, vat: 0, total: 100 });

    const excluded = computeInvoiceLine({ quantity: 1, unitPrice: 100, priceIncludesVat: false, vatApplicable: false });
    expect(excluded).toEqual({ subtotal: 100, vat: 0, total: 100 });
  });

  it("applies quantity and discount before computing VAT, still reconciling exactly", () => {
    // 2 * 50 * (1 - 10%) = 90 شامل الضريبة → نفس منطق الاختبار الأول بمقياس مختلف.
    const { subtotal, vat, total } = computeInvoiceLine({ quantity: 2, unitPrice: 50, discountPct: 10, priceIncludesVat: true });
    expect(subtotal + vat).toBe(total);
    expect(Number((subtotal + vat).toFixed(2))).toBe(Number(total.toFixed(2)));
  });

  it("sums rounded per-line totals to a header total that agrees with the lines (no residual drift)", () => {
    const lines = [
      computeInvoiceLine({ quantity: 1, unitPrice: 105, priceIncludesVat: true }),
      computeInvoiceLine({ quantity: 1, unitPrice: 33.33, priceIncludesVat: false }),
      computeInvoiceLine({ quantity: 3, unitPrice: 10.1, priceIncludesVat: true }),
    ];
    const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
    const vatTotal = lines.reduce((s, l) => s + l.vat, 0);
    const grandTotal = subtotal + vatTotal;
    // إجمالي الرأس هو مجموع (صافي+ضريبة) كل سطر — يجب أن يطابق مجموع total لكل سطر بنفس الدقة.
    const sumOfLineTotals = lines.reduce((s, l) => s + l.total, 0);
    expect(Number(grandTotal.toFixed(2))).toBe(Number(sumOfLineTotals.toFixed(2)));
  });
});
