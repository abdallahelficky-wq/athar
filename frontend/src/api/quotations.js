import { api } from "./http";

export const listQuotations = (companyId) => api.get(`/quotations?companyId=${companyId}`);
export const createQuotation = (payload) => api.post("/quotations", payload);
export const updateQuotation = (id, payload) => api.patch(`/quotations/${id}`, payload);
export const deleteQuotation = (id) => api.delete(`/quotations/${id}`);
export const convertQuotationToInvoice = (id) => api.post(`/quotations/${id}/convert-to-invoice`);
