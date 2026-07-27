import { api } from "./http";

function qs(params) {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return parts.length ? `?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
}

export const getFinancialKpis = (companyId, dateFrom, dateTo) =>
  api.get(`/dashboard/financial-kpis${qs({ companyId, dateFrom, dateTo })}`);
export const getCashBreakdown = (companyId) => api.get(`/dashboard/cash-breakdown${qs({ companyId })}`);
export const getCashFlowMonthly = (companyId, months = 12) => api.get(`/dashboard/cash-flow-monthly${qs({ companyId, months })}`);
export const getTopCashTransactions = (companyId, limit = 10) =>
  api.get(`/dashboard/top-cash-transactions${qs({ companyId, limit })}`);
export const getFinancialPosition = (companyId, asOfDate) => api.get(`/dashboard/financial-position${qs({ companyId, asOfDate })}`);
export const getSalesTrend = (companyId, months = 12) => api.get(`/dashboard/sales-trend${qs({ companyId, months })}`);
export const getTopCustomers = (companyId, limit = 10) => api.get(`/dashboard/top-customers${qs({ companyId, limit })}`);
export const getFinancialAlerts = (companyId, withinDays = 60) =>
  api.get(`/dashboard/financial-alerts${qs({ companyId, withinDays })}`);

export const getHrKpis = (companyId) => api.get(`/dashboard/hr-kpis${qs({ companyId })}`);
export const getHrPayrollTrend = (companyId, months = 12) => api.get(`/dashboard/hr-payroll-trend${qs({ companyId, months })}`);
export const getHrHeadcount = (companyId) => api.get(`/dashboard/hr-headcount${qs({ companyId })}`);
export const getHrNationality = (companyId) => api.get(`/dashboard/hr-nationality${qs({ companyId })}`);
export const getHrAlerts = (companyId, withinDays = 60) => api.get(`/dashboard/hr-alerts${qs({ companyId, withinDays })}`);
