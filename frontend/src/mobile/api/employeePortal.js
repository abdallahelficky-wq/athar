import { employeePortalApi } from "./employeePortalHttp";

export const login = (tenantId, phone, pin) => employeePortalApi.post("/employee-portal/login", { tenantId, phone, pin });
export const getMe = () => employeePortalApi.get("/employee-portal/me");

export const checkIn = () => employeePortalApi.post("/attendance/check-in");
export const checkOut = () => employeePortalApi.post("/attendance/check-out");
export const myAttendance = () => employeePortalApi.get("/attendance/me");

export const listMyLeaveRequests = () => employeePortalApi.get("/employee-portal/leave-requests");
export const getLeaveBalance = () => employeePortalApi.get("/employee-portal/leave-requests/balance");
export const createLeaveRequest = (payload) => employeePortalApi.post("/employee-portal/leave-requests", payload);
export const getManagerInbox = () => employeePortalApi.get("/employee-portal/leave-requests/inbox");
export const approveLeaveRequest = (id) => employeePortalApi.post(`/employee-portal/leave-requests/${id}/approve`);
export const rejectLeaveRequest = (id) => employeePortalApi.post(`/employee-portal/leave-requests/${id}/reject`);
