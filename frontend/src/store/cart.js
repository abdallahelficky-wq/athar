// سلة المشتريات — في متصفح الزائر فقط (localStorage لكل متجر). لا طلب يُحفَظ في الخادم في هذه المرحلة:
// الطلب يُرسَل رسالة واتساب جاهزة. القراءة والكتابة داخل try/catch لأن التخزين قد يكون محجوباً (تصفح خاص).
const key = (slug) => `athar.store.cart.${slug}`;

export function loadCart(slug) {
  try {
    const rows = JSON.parse(localStorage.getItem(key(slug)) || "[]");
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.code === "string" && Number(r.qty) > 0) : [];
  } catch {
    return [];
  }
}

export function saveCart(slug, rows) {
  try { localStorage.setItem(key(slug), JSON.stringify(rows)); } catch { /* يبقى في الذاكرة فقط */ }
}

export const MAX_QTY = 999;
const clampQty = (n) => Math.min(MAX_QTY, Math.max(1, Math.floor(Number(n) || 1)));

/** لقطة من المنتج تكفي لعرض السلة فوراً؛ الأسعار تُحدَّث من الخادم عند فتح صفحة السلة. */
const snapshot = (p) => ({ code: p.code, name: p.name, nameEn: p.nameEn, price: p.price, priceExVat: p.priceExVat, vat: p.vat, image: p.images?.[0] || null });

export function addToCart(rows, product, qty) {
  const existing = rows.find((r) => r.code === product.code);
  if (existing) return rows.map((r) => (r.code === product.code ? { ...r, ...snapshot(product), qty: clampQty(r.qty + qty) } : r));
  return [...rows, { ...snapshot(product), qty: clampQty(qty) }];
}
export const setQty = (rows, code, qty) => rows.map((r) => (r.code === code ? { ...r, qty: clampQty(qty) } : r));
export const removeFromCart = (rows, code) => rows.filter((r) => r.code !== code);
export const refreshRow = (row, product) => ({ ...row, ...snapshot(product) });

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function cartTotals(rows) {
  const total = round2(rows.reduce((s, r) => s + r.price * r.qty, 0));
  const exVat = round2(rows.reduce((s, r) => s + r.priceExVat * r.qty, 0));
  return { count: rows.reduce((s, r) => s + r.qty, 0), exVat, vat: round2(total - exVat), total };
}
