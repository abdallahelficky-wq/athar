import { fromHalalas, roundMoney, toHalalas, vatInGrossHalalas, vatOnNetHalalas } from "./money";

export const VAT_RATE = 0.15;

export interface InvoiceLineInput {
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
  vatApplicable?: boolean;
  taxCategoryCode?: string | null;
}

/**
 * مبالغ سطر فاتورة — مع `vatApplicable` (افتراضها true للحفاظ على التوافق مع المشتريات/المردودات التي لا ترسله) لدعم
 * أصناف غير خاضعة للضريبة — عند false يكون الناتج صفر ضريبة دائماً بغض النظر عن priceIncludesVat.
 *
 * قاعدة تقريب واحدة (src/lib/money.ts): كل مبلغ في السطر يُقرَّب مرة واحدة لخانتين، نصف للأعلى، والباقي يُشتَق بالجمع/الطرح
 * بالهللات — فالصافي والضريبة والإجمالي أرقام بخانتين دائماً و net + vat = total بالضبط. كان الصافي يُترَك بلا تقريب
 * (191.105…) فيصل XML زاتكا كما هو: يُقصّ في السطر ويُقرَّب في الإجمالي ⇒ رفض BR-CO-15 وتحذير BR-KSA-51.
 * - السعر غير شامل: الصافي = تقريب(كمية × سعر × (1 − خصم))، الضريبة = تقريب(الصافي × 15%).
 * - السعر شامل: الإجمالي = تقريب(كمية × سعر × (1 − خصم))، الضريبة = تقريب(الإجمالي × 15 / 115)، الصافي = الإجمالي − الضريبة.
 * نسخة الواجهة المطابقة: frontend/src/wired/shared/invoiceLine.js.
 */
export function computeInvoiceLine(l: InvoiceLineInput) {
  const qty = Number(l.quantity || 0);
  const price = Number(l.unitPrice || 0);
  const disc = Number(l.discountPct || 0);
  const grossLine = qty * price * (1 - disc / 100);
  const ratePercent = VAT_RATE * 100;

  if (l.taxCategoryCode ? l.taxCategoryCode !== "S" : l.vatApplicable === false) {
    const net = roundMoney(grossLine);
    return { subtotal: net, vat: 0, total: net };
  }

  if (l.priceIncludesVat) {
    const totalH = toHalalas(grossLine);
    const vatH = vatInGrossHalalas(totalH, ratePercent);
    return { subtotal: fromHalalas(totalH - vatH), vat: fromHalalas(vatH), total: fromHalalas(totalH) };
  }
  const netH = toHalalas(grossLine);
  const vatH = vatOnNetHalalas(netH, ratePercent);
  return { subtotal: fromHalalas(netH), vat: fromHalalas(vatH), total: fromHalalas(netH + vatH) };
}

export interface CustomerLike {
  customerType: "business" | "individual";
  vatNumber?: string | null;
}

/** فاتورة ضريبية قياسية للمنشآت (لديها رقم ضريبي)، مبسّطة لغير ذلك — مطابق لـ invoiceTypeForCustomer */
export function invoiceTypeForCustomer(customer: CustomerLike | null | undefined): "standard" | "simplified" {
  return customer && customer.customerType === "business" && customer.vatNumber ? "standard" : "simplified";
}
