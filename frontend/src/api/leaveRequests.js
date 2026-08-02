import { api } from "./http";

export const listLeaveRequests = (companyId) => api.get(`/leave-requests?companyId=${companyId}`);
export const createLeaveRequest = (payload) => api.post("/leave-requests", payload);
export const approveLeaveRequest = (id) => api.post(`/leave-requests/${id}/approve`);
export const rejectLeaveRequest = (id) => api.post(`/leave-requests/${id}/reject`);
export const deleteLeaveRequest = (id) => api.delete(`/leave-requests/${id}`);
