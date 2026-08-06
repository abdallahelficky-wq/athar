import { api } from "./http";

export const listPayrollComponents = (companyId) => api.get(`/companies/${companyId}/payroll-components`);
export const listAdjustableComponents = (companyId) => api.get(`/companies/${companyId}/payroll-components/adjustable`);
export const createPayrollComponent = (companyId, payload) => api.post(`/companies/${companyId}/payroll-components`, payload);
export const updatePayrollComponent = (id, payload) => api.patch(`/payroll-components/${id}`, payload);
export const deletePayrollComponent = (id) => api.delete(`/payroll-components/${id}`);

export const getPayrollSettings = (companyId) => api.get(`/companies/${companyId}/payroll-settings`);
export const updatePayrollSettings = (companyId, payload) => api.patch(`/companies/${companyId}/payroll-settings`, payload);

export const getEmployeePayrollComponents = (employeeId) => api.get(`/employees/${employeeId}/payroll-components`);
export const setEmployeePayrollComponents = (employeeId, items) => api.put(`/employees/${employeeId}/payroll-components`, items);
