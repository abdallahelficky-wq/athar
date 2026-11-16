/**
 * سعر العرض في المتجر العام: دائماً شامل الضريبة، مع السعر قبل الضريبة ومبلغها للتفصيل في السلة.
 * نفس قاعدة الفاتورة: الصنف خاضع (فئة S) تُحسَب له ضريبة الشركة، وغيره (Z/E/O) بلا ضريبة؛ وpriceIncludesVat
 * يحدّد هل salePrice المخزَّن شامل أم لا. فئة قديمة غير مصنَّفة تتبع vatApplicable (راجع normalizeTax في lib/itemTax.ts).
 */
export interface StorePriceInput {
  salePrice: number;
  priceIncludesVat: boolean;
  taxCategoryCode?: string | null;
  vatApplicable: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function isTaxable(item: Pick<StorePriceInput, "taxCategoryCode" | "vatApplicable">): boolean {
  return (item.taxCategoryCode ?? (item.vatApplicable === false ? "O" : "S")) === "S";
}

export function storePrice(item: StorePriceInput, vatRatePercent: number) {
  const rate = isTaxable(item) ? vatRatePercent / 100 : 0;
  const price = round2(item.priceIncludesVat ? item.salePrice : item.salePrice * (1 + rate));
  const priceExVat = round2(item.priceIncludesVat ? item.salePrice / (1 + rate) : item.salePrice);
  return { price, priceExVat, vat: round2(price - priceExVat), vatRatePercent: rate * 100 };
}
