import { api } from "./http";

export const listPurchaseInvoices = (companyId) => api.get(`/purchase-invoices?companyId=${companyId}`);
export const createPurchaseInvoice = (payload) => api.post("/purchase-invoices", payload);
export const updatePurchaseInvoice = (id, payload) => api.patch(`/purchase-invoices/${id}`, payload);
export const deletePurchaseInvoice = (id) => api.delete(`/purchase-invoices/${id}`);
export const postPurchaseInvoice = (id) => api.post(`/purchase-invoices/${id}/post`);
export const unpostPurchaseInvoice = (id, pin) => api.post(`/purchase-invoices/${id}/unpost`, { pin });
