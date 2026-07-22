import { api } from "./http";

export const listCustomers = (companyId) => api.get(`/customers?companyId=${companyId}`);
export const getCustomerBalance = (id) => api.get(`/customers/${id}/balance`);
export const createCustomer = (payload) => api.post("/customers", payload);
export const updateCustomer = (id, payload) => api.patch(`/customers/${id}`, payload);
export const deleteCustomer = (id) => api.delete(`/customers/${id}`);
