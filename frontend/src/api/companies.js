import { api } from "./http";

export const listCompanies = () => api.get("/companies");
export const createCompany = (payload) => api.post("/companies", payload);
export const updateCompany = (id, payload) => api.patch(`/companies/${id}`, payload);
export const deleteCompany = (id) => api.delete(`/companies/${id}`);

export const uploadCompanyLogo = (id, file) => {
  const form = new FormData();
  form.append("file", file);
  return api.postForm(`/companies/${id}/logo`, form);
};

export const extractCompanyDocument = (id, docType, file) => {
  const form = new FormData();
  form.append("docType", docType);
  form.append("file", file);
  return api.postForm(`/companies/${id}/extract-document`, form);
};

// ربط فاتورة (ZATCA) — انظر src/modules/companiesZatca على الخادم
export const getCompanyZatcaStatus = (id) => api.get(`/companies/${id}/zatca`);
export const generateCompanyZatcaCsr = (id, payload) => api.post(`/companies/${id}/zatca/csr`, payload);
export const requestCompanyZatcaCompliance = (id, otp) => api.post(`/companies/${id}/zatca/compliance`, { otp });
export const requestCompanyZatcaProduction = (id) => api.post(`/companies/${id}/zatca/production`, {});
export const setCompanyZatcaEnvironment = (id, environment) => api.patch(`/companies/${id}/zatca/environment`, { environment });
export const resetCompanyZatcaLinkage = (id) => api.delete(`/companies/${id}/zatca`);
