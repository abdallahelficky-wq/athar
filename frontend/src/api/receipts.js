import { api } from "./http";

export const listReceipts = (companyId, customerId) =>
  api.get(`/receipts?companyId=${companyId}${customerId ? `&customerId=${customerId}` : ""}`);
export const getOutstandingInvoices = (customerId) => api.get(`/receipts/outstanding-invoices/${customerId}`);
export const createReceipt = (payload) => api.post("/receipts", payload);
export const deleteReceipt = (id) => api.delete(`/receipts/${id}`);
export const postReceipt = (id) => api.post(`/receipts/${id}/post`);
export const unpostReceipt = (id, pin) => api.post(`/receipts/${id}/unpost`, { pin });
export const addReceiptAllocation = (id, invoiceId, amount) => api.post(`/receipts/${id}/allocations`, { invoiceId, amount });
export const removeReceiptAllocation = (id, invoiceId) => api.delete(`/receipts/${id}/allocations/${invoiceId}`);
