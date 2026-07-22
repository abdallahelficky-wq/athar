import { api } from "./http";

export const listCompanies = () => api.get("/companies");
export const createCompany = (payload) => api.post("/companies", payload);
export const updateCompany = (id, payload) => api.patch(`/companies/${id}`, payload);
export const deleteCompany = (id) => api.delete(`/companies/${id}`);
