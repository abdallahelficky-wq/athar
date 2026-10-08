export const VAT_RATE = 0.15;

// نفس قاعدة التقريب في الخادم (src/lib/money.ts): خانتان، نصف للأعلى، على التمثيل العشري الأقصر للرقم، وحساب الضريبة بأعداد صحيحة
// بالهللات — حتى تطابق معاينة الشاشة ما يُخزَّن ويُرسَل لزاتكا هللةً بهللة.
function toHalalas(n) {
  if (!Number.isFinite(n)) return 0;
  const negative = n < 0;
  let s = Math.abs(n).toString();
  if (s.includes("e")) s = Math.abs(n).toFixed(20);
  const [intPart, fracPart = ""] = s.split(".");
  const frac = (fracPart + "000").slice(0, 3);
  let h = Number(intPart) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) h += 1;
  return negative ? -h : h;
}
function mulDivHalfUp(h, num, den) {
  const p = BigInt(h) * BigInt(num);
  const d = BigInt(den);
  const sign = p < 0n ? -1n : 1n;
  const abs = p < 0n ? -p : p;
  return Number(sign * ((abs * 2n + d) / (2n * d)));
}

/** مطابق لـ computeInvoiceLine في الخادم (src/lib/invoiceLine.ts) — راجع تعليقها لقاعدة التقريب */
export function computeInvoiceLine(l) {
  const qty = Number(l.quantity || 0), price = Number(l.unitPrice || 0), disc = Number(l.discountPct || 0);
  const grossLine = qty * price * (1 - disc / 100);
  const rate = Math.round(VAT_RATE * 10000);
  if (l.taxCategoryCode ? l.taxCategoryCode !== "S" : l.vatApplicable === false) {
    const net = toHalalas(grossLine) / 100;
    return { subtotal: net, vat: 0, total: net };
  }
  if (l.priceIncludesVat) {
    const totalH = toHalalas(grossLine);
    const vatH = mulDivHalfUp(totalH, rate, 10000 + rate);
    return { subtotal: (totalH - vatH) / 100, vat: vatH / 100, total: totalH / 100 };
  }
  const netH = toHalalas(grossLine);
  const vatH = mulDivHalfUp(netH, rate, 10000);
  return { subtotal: netH / 100, vat: vatH / 100, total: (netH + vatH) / 100 };
}
