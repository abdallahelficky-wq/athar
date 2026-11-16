// عميل المسارات العامة للمتجر (GET /api/store/*) — بلا رمز دخول عمداً، ومستقل عن api/http.js الذي يرفق رمز المستخدم.
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export class StoreApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function get(path, lang) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "Accept-Language": lang || "ar" } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* رد غير JSON */ }
  if (!res.ok) throw new StoreApiError(res.status, data?.error || "");
  return data;
}

const enc = encodeURIComponent;

export const fetchStore = (slug, lang) => get(`/store/${enc(slug)}`, lang);
export const fetchProducts = (slug, { category, search, sort, page, pageSize } = {}, lang) => {
  const q = new URLSearchParams();
  if (category) q.set("category", category);
  if (search) q.set("search", search);
  if (sort) q.set("sort", sort);
  if (page) q.set("page", String(page));
  if (pageSize) q.set("pageSize", String(pageSize));
  const qs = q.toString();
  return get(`/store/${enc(slug)}/products${qs ? `?${qs}` : ""}`, lang);
};
export const fetchProduct = (slug, code, lang) => get(`/store/${enc(slug)}/products/${enc(code)}`, lang);

/** مسار الصورة النسبي القادم من الخادم (/store/<slug>/images/<id>) → رابط كامل. */
export const imageUrl = (path) => (path ? `${BASE_URL}${path}` : null);

// ── حساب العميل والطلبات ── رمز عميل المتجر (لا رمز مستخدم أثر) يُمرَّر صراحةً لكل نداء يحتاجه.
async function send(method, path, { body, token, lang } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Accept-Language": lang || "ar", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* رد غير JSON */ }
  if (!res.ok) throw new StoreApiError(res.status, data?.error || "");
  return data;
}

export const requestOtp = (slug, phone, lang) => send("POST", `/store/${enc(slug)}/auth/request-otp`, { body: { phone }, lang });
export const verifyOtp = (slug, phone, code, lang) => send("POST", `/store/${enc(slug)}/auth/verify-otp`, { body: { phone, code }, lang });
export const fetchMe = (slug, token, lang) => send("GET", `/store/${enc(slug)}/me`, { token, lang });
export const updateMe = (slug, token, profile, lang) => send("PATCH", `/store/${enc(slug)}/me`, { token, body: profile, lang });
export const createOrder = (slug, token, order, lang) => send("POST", `/store/${enc(slug)}/orders`, { token, body: order, lang });
export const fetchMyOrders = (slug, token, lang) => send("GET", `/store/${enc(slug)}/orders`, { token, lang });
