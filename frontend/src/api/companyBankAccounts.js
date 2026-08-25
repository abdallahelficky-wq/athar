import { api } from "./http";

export const listCompanyBankAccounts = (companyId) => api.get(`/company-bank-accounts?companyId=${companyId}`);
export const createCompanyBankAccount = (payload) => api.post("/company-bank-accounts", payload);
export const updateCompanyBankAccount = (id, payload) => api.patch(`/company-bank-accounts/${id}`, payload);
export const deleteCompanyBankAccount = (id) => api.delete(`/company-bank-accounts/${id}`);
