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
