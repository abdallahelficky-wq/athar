import { api } from "./http";

// عقود الإيجار وموديول الإيجارات (جدول الدفعات، تأكيد السداد، الإطفاء الشهري) — راجع src/modules/leaseContracts
export const listLeaseContracts = (companyId) => api.get(`/lease-contracts?companyId=${companyId}`);
export const createLeaseContract = (payload) => api.post("/lease-contracts", payload);
export const updateLeaseContract = (id, payload) => api.patch(`/lease-contracts/${id}`, payload);
export const deleteLeaseContract = (id) => api.delete(`/lease-contracts/${id}`);
export const applyLeaseAccounts = (payload) => api.post("/lease-contracts/accounts", payload);
export const importLeaseContracts = (companyId, contracts) => api.post("/lease-contracts/import", { companyId, contracts });

export const leaseAlerts = (companyId) => api.get(`/lease-contracts/alerts?companyId=${companyId}`);
export const leaseCalendar = (companyId, from, to) => api.get(`/lease-contracts/calendar?companyId=${companyId}&from=${from}&to=${to}`);
export const generateLeaseSchedule = (contractId, until) => api.post(`/lease-contracts/${contractId}/schedule`, until ? { until } : {});
export const createLeasePayment = (payload) => api.post("/lease-contracts/payments", payload);
export const updateLeasePayment = (id, payload) => api.patch(`/lease-contracts/payments/${id}`, payload);
export const deleteLeasePayment = (id) => api.delete(`/lease-contracts/payments/${id}`);
export const confirmLeasePayment = (id, payload) => api.post(`/lease-contracts/payments/${id}/confirm`, payload);
export const reverseLeasePayment = (id, reason) => api.post(`/lease-contracts/payments/${id}/reverse`, { reason });

export const listLeaseAmortizationRuns = (companyId) => api.get(`/lease-contracts/amortization?companyId=${companyId}`);
export const previewLeaseAmortization = (companyId, month) => api.get(`/lease-contracts/amortization/preview?companyId=${companyId}&month=${month}`);
export const postLeaseAmortization = (companyId, month) => api.post("/lease-contracts/amortization", { companyId, month });
export const removeLeaseAmortizationRun = (id, pin) => api.delete(`/lease-contracts/amortization/${id}`, { pin });
