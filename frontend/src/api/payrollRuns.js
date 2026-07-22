import { api } from "./http";

export const listPayrollRuns = (companyId, month) => api.get(`/payroll-runs?companyId=${companyId}${month ? `&month=${month}` : ""}`);
export const createPayrollRun = (payload) => api.post("/payroll-runs", payload);
export const getPayrollRunRows = (id) => api.get(`/payroll-runs/${id}/rows`);
export const updatePayrollRunEmployees = (id, employeeIds) => api.patch(`/payroll-runs/${id}/employees`, { employeeIds });
export const setPayrollRowOverride = (id, employeeId, override) => api.put(`/payroll-runs/${id}/overrides/${employeeId}`, override);
export const clearPayrollRowOverride = (id, employeeId) => api.delete(`/payroll-runs/${id}/overrides/${employeeId}`);
export const postPayrollRun = (id) => api.post(`/payroll-runs/${id}/post`);
export const unpostPayrollRun = (id, pin) => api.post(`/payroll-runs/${id}/unpost`, { pin });
