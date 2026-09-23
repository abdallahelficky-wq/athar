export const VAT_RATE = 0.15;

/** مطابق حرفياً لـ computeInvoiceLine في AtharAlMuhasabi.jsx وفي backend src/lib/invoiceLine.ts */
export function computeInvoiceLine(l) {
  const qty = Number(l.quantity || 0), price = Number(l.unitPrice || 0), disc = Number(l.discountPct || 0);
  const grossLine = qty * price * (1 - disc / 100);
  if (l.taxCategoryCode ? l.taxCategoryCode !== "S" : l.vatApplicable === false) {
    return { subtotal: grossLine, vat: 0, total: grossLine };
  }
  if (l.priceIncludesVat) {
    const vat = Math.round((grossLine - grossLine / (1 + VAT_RATE)) * 100) / 100;
    const subtotal = grossLine - vat;
    return { subtotal, vat, total: grossLine };
  }
  const subtotal = grossLine;
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100;
  return { subtotal, vat, total: subtotal + vat };
}
