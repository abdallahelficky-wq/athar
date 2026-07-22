import { api } from "./http";

export const listLeaveRequests = (companyId) => api.get(`/leave-requests?companyId=${companyId}`);
export const createLeaveRequest = (payload) => api.post("/leave-requests", payload);
export const deleteLeaveRequest = (id) => api.delete(`/leave-requests/${id}`);
