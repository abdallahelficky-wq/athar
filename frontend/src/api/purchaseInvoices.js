import { api } from "./http";

export const listPurchaseInvoices = (companyId) => api.get(`/purchase-invoices?companyId=${companyId}`);
// صفحة واحدة مع العدد الكلي وعدّاد الحالات (parseListPage في الخادم) — لشاشة القائمة؛ listPurchaseInvoices يبقى للمنتقيات
export const listPurchaseInvoicesPage = (companyId, params) => {
  const q = new URLSearchParams({ companyId });
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return api.get(`/purchase-invoices?${q}`);
};
export const createPurchaseInvoice = (payload) => api.post("/purchase-invoices", payload);
export const updatePurchaseInvoice = (id, payload) => api.patch(`/purchase-invoices/${id}`, payload);
export const deletePurchaseInvoice = (id) => api.delete(`/purchase-invoices/${id}`);
export const postPurchaseInvoice = (id) => api.post(`/purchase-invoices/${id}/post`);
export const unpostPurchaseInvoice = (id, pin) => api.post(`/purchase-invoices/${id}/unpost`, { pin });
