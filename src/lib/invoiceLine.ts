export const VAT_RATE = 0.15;

export interface InvoiceLineInput {
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
}

/** مطابق حرفياً لدالة computeInvoiceLine في AtharAlMuhasabi.jsx (المرجع الحي) */
export function computeInvoiceLine(l: InvoiceLineInput) {
  const qty = Number(l.quantity || 0);
  const price = Number(l.unitPrice || 0);
  const disc = Number(l.discountPct || 0);
  const grossLine = qty * price * (1 - disc / 100);

  if (l.priceIncludesVat) {
    const subtotal = grossLine / (1 + VAT_RATE);
    const vat = grossLine - subtotal;
    return { subtotal, vat, total: grossLine };
  }
  const subtotal = grossLine;
  const vat = subtotal * VAT_RATE;
  return { subtotal, vat, total: subtotal + vat };
}

export interface CustomerLike {
  customerType: "business" | "individual";
  vatNumber?: string | null;
}

/** فاتورة ضريبية قياسية للمنشآت (لديها رقم ضريبي)، مبسّطة لغير ذلك — مطابق لـ invoiceTypeForCustomer */
export function invoiceTypeForCustomer(customer: CustomerLike | null | undefined): "standard" | "simplified" {
  return customer && customer.customerType === "business" && customer.vatNumber ? "standard" : "simplified";
}
