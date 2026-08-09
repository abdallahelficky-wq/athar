import { api } from "./http";

export const listSalesInvoices = (companyId) => api.get(`/sales-invoices?companyId=${companyId}`);
export const getSalesInvoice = (id) => api.get(`/sales-invoices/${id}`);
export const createSalesInvoice = (payload) => api.post("/sales-invoices", payload);
export const updateSalesInvoice = (id, payload) => api.patch(`/sales-invoices/${id}`, payload);
export const deleteSalesInvoice = (id) => api.delete(`/sales-invoices/${id}`);
export const postSalesInvoice = (id) => api.post(`/sales-invoices/${id}/post`);
export const unpostSalesInvoice = (id, pin) => api.post(`/sales-invoices/${id}/unpost`, { pin });
export const sendInvoiceEmail = (id, email) => api.post(`/sales-invoices/${id}/send-email`, email ? { email } : {});
export const resendInvoiceZatca = (id) => api.post(`/sales-invoices/${id}/resend-zatca`);
