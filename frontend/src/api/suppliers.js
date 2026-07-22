import { api } from "./http";

export const listSuppliers = (companyId) => api.get(`/suppliers?companyId=${companyId}`);
export const getSupplierBalance = (id) => api.get(`/suppliers/${id}/balance`);
export const createSupplier = (payload) => api.post("/suppliers", payload);
export const updateSupplier = (id, payload) => api.patch(`/suppliers/${id}`, payload);
export const deleteSupplier = (id) => api.delete(`/suppliers/${id}`);
