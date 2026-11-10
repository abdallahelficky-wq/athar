import { api } from "./http";

export const listLeaveSettlements = (companyId, employeeId) =>
  api.get(`/leave-settlements?companyId=${companyId}${employeeId ? `&employeeId=${employeeId}` : ""}`);
export const previewLeaveSettlement = (employeeId, leaveStartDate, leaveEndDate, settlementType, cashLeaveDays) =>
  api.get(`/leave-settlements/preview?employeeId=${employeeId}&leaveStartDate=${leaveStartDate}&leaveEndDate=${leaveEndDate || ""}&settlementType=${settlementType}&cashLeaveDays=${cashLeaveDays || 0}`);
export const createLeaveSettlement = (payload) => api.post("/leave-settlements", payload);
export const disburseLeaveSettlement = (id, payload) => api.post(`/leave-settlements/${id}/disburse`, payload);
export const registerLeaveReturn = (payload) => api.post("/leave-returns", payload);
export const previewAnnualLeave = payload => api.post("/leave-settlements/annual-preview", payload);
export const saveAnnualLeaveDraft = payload => api.post("/leave-settlements/annual-drafts", payload);
export const listAnnualLeaveDrafts = companyId => api.get(`/leave-settlements/annual-drafts?companyId=${encodeURIComponent(companyId)}`);
export const updateAnnualLeaveDraft = (id, payload) => api.put(`/leave-settlements/annual-drafts/${encodeURIComponent(id)}`, payload);
export const deleteAnnualLeaveDraft = id => api.delete(`/leave-settlements/annual-drafts/${encodeURIComponent(id)}`);
export const previewAnnualLeaveJournal = (id, accounts) => api.post(`/leave-settlements/annual-drafts/${encodeURIComponent(id)}/journal-preview`, accounts);
export const postAnnualLeaveDraft = (id, accounts) => api.post(`/leave-settlements/annual-drafts/${encodeURIComponent(id)}/post`, accounts);
