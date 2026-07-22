import { api } from "./http";

export const getSalesByCustomer = (companyId) => api.get(`/sales-reports/by-customer?companyId=${companyId}`);
export const getSalesMonthly = (companyId) => api.get(`/sales-reports/monthly?companyId=${companyId}`);
export const getSalesVatSummary = (companyId) => api.get(`/sales-reports/vat-summary?companyId=${companyId}`);
export const getReceivablesAging = (companyId) => api.get(`/sales-reports/aging?companyId=${companyId}`);
