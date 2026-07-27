import { api } from "./http";

export const listCompanyDocuments = (companyId) => api.get(`/company-documents?companyId=${companyId}`);
export const createCompanyDocument = (payload) => api.post("/company-documents", payload);
export const updateCompanyDocument = (id, payload) => api.patch(`/company-documents/${id}`, payload);
export const deleteCompanyDocument = (id) => api.delete(`/company-documents/${id}`);
