import { api } from "./http";

export const listReceipts = (companyId) => api.get(`/receipts?companyId=${companyId}`);
export const getOutstandingInvoices = (customerId) => api.get(`/receipts/outstanding-invoices/${customerId}`);
export const createReceipt = (payload) => api.post("/receipts", payload);
export const deleteReceipt = (id) => api.delete(`/receipts/${id}`);
export const postReceipt = (id) => api.post(`/receipts/${id}/post`);
export const unpostReceipt = (id, pin) => api.post(`/receipts/${id}/unpost`, { pin });
