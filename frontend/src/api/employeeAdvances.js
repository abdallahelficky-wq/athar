import { api } from "./http";

export const listEmployeeAdvances = (companyId, employeeId) => {
  const params = new URLSearchParams({ companyId });
  if (employeeId) params.set("employeeId", employeeId);
  return api.get(`/employee-advances?${params.toString()}`);
};
export const createEmployeeAdvance = (payload) => api.post("/employee-advances", payload);
export const removeEmployeeAdvance = (id, pin) => api.delete(`/employee-advances/${id}`, { pin });
