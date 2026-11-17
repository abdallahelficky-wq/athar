/**
 * حساب إجمالي طلب المتجر — دالة صِرفة يستخدمها عرض السعر (quote) وإنشاء الطلب معاً، فما يراه العميل في السلة هو ما يُسجَّل.
 * كل المبالغ شاملة الضريبة كما تُعرَض للعميل:
 *   المجموع = مجموع الأصناف − خصم الكوبون + الشحن.
 *  - الكوبون يخصم من مجموع الأصناف فقط (لا من الشحن)، ولا يتجاوزه.
 *  - الشحن المجاني يُقاس على مجموع الأصناف بعد الخصم.
 *  - الضريبة المعروضة: ضريبة الأصناف مخفَّضة بنسبة الخصم نفسها، زائد ضريبة الشحن بنسبة الشركة.
 */
export interface CheckoutLine { lineTotal: number; lineExVat: number }
export interface CheckoutCoupon { code: string; type: "percent" | "fixed"; value: number; minOrderAmount: number | null }
export interface CheckoutInput {
  lines: CheckoutLine[];
  coupon: CheckoutCoupon | null;
  /** رسوم الشحن قبل تطبيق الشحن المجاني (0 للاستلام أو لمتجر بلا مناطق شحن) */
  shippingFee: number;
  freeShippingOver: number | null;
  vatRatePercent: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeCheckout(input: CheckoutInput) {
  const itemsTotal = round2(input.lines.reduce((s, l) => s + l.lineTotal, 0));
  const itemsExVat = round2(input.lines.reduce((s, l) => s + l.lineExVat, 0));

  let discount = 0;
  let couponApplied = false;
  if (input.coupon && (input.coupon.minOrderAmount == null || itemsTotal >= input.coupon.minOrderAmount)) {
    discount = input.coupon.type === "percent" ? round2((itemsTotal * Math.min(input.coupon.value, 100)) / 100) : round2(input.coupon.value);
    discount = Math.min(Math.max(discount, 0), itemsTotal);
    couponApplied = discount > 0;
  }
  const itemsAfterDiscount = round2(itemsTotal - discount);
  const freeShipping = input.freeShippingOver != null && itemsAfterDiscount >= input.freeShippingOver;
  const shippingFee = freeShipping ? 0 : round2(Math.max(input.shippingFee, 0));
  const total = round2(itemsAfterDiscount + shippingFee);

  const itemsVat = itemsTotal > 0 ? ((itemsTotal - itemsExVat) * itemsAfterDiscount) / itemsTotal : 0;
  const rate = input.vatRatePercent / 100;
  const shippingVat = shippingFee - shippingFee / (1 + rate);
  const vat = round2(itemsVat + shippingVat);

  return { itemsTotal, discount, couponApplied, shippingFee, freeShipping, subtotal: round2(total - vat), vat, total };
}
