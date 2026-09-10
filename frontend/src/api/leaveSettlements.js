import { api } from "./http";

export const listLeaveSettlements = (companyId, employeeId) =>
  api.get(`/leave-settlements?companyId=${companyId}${employeeId ? `&employeeId=${employeeId}` : ""}`);
export const previewLeaveSettlement = (employeeId, leaveStartDate, leaveEndDate, settlementType, cashLeaveDays) =>
  api.get(`/leave-settlements/preview?employeeId=${employeeId}&leaveStartDate=${leaveStartDate}&leaveEndDate=${leaveEndDate || ""}&settlementType=${settlementType}&cashLeaveDays=${cashLeaveDays || 0}`);
export const createLeaveSettlement = (payload) => api.post("/leave-settlements", payload);
export const disburseLeaveSettlement = (id, payload) => api.post(`/leave-settlements/${id}/disburse`, payload);
export const registerLeaveReturn = (payload) => api.post("/leave-returns", payload);
