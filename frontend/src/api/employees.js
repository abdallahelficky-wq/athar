import { api } from "./http";

export const listEmployees = (companyId) => api.get(`/employees?companyId=${companyId}`);
export const getEmployee = (id) => api.get(`/employees/${id}`);
export const createEmployee = (payload) => api.post("/employees", payload);
export const importEmployees = (payload) => api.post("/employees/import", payload);
export const updateEmployee = (id, payload) => api.patch(`/employees/${id}`, payload);
export const deleteEmployee = (id) => api.delete(`/employees/${id}`);
export const getEmployeePortalAccess = (id) => api.get(`/employees/${id}/portal-access`);
export const setEmployeePortalAccess = (id, payload) => api.post(`/employees/${id}/portal-access`, payload);
export const getEmployeeEos = (id, endDate, reason) => api.get(`/employees/${id}/eos?endDate=${endDate}&reason=${reason}`);
