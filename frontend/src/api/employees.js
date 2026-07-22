import { api } from "./http";

export const listEmployees = (companyId) => api.get(`/employees?companyId=${companyId}`);
export const getEmployee = (id) => api.get(`/employees/${id}`);
export const createEmployee = (payload) => api.post("/employees", payload);
export const updateEmployee = (id, payload) => api.patch(`/employees/${id}`, payload);
export const deleteEmployee = (id) => api.delete(`/employees/${id}`);
export const getEmployeeEos = (id, endDate, reason) => api.get(`/employees/${id}/eos?endDate=${endDate}&reason=${reason}`);
