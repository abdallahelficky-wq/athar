import { api } from "./http";

export const getSalesByCustomer = (companyId) => api.get(`/sales-reports/by-customer?companyId=${companyId}`);
export const getSalesMonthly = (companyId) => api.get(`/sales-reports/monthly?companyId=${companyId}`);
export const getSalesVatSummary = ({ companyId, from, to }) =>
  api.get(`/sales-reports/vat-summary?${new URLSearchParams({ companyId, from, to })}`);
export const getReceivablesAging = (companyId, asOf) => api.get(`/sales-reports/aging?${new URLSearchParams({ companyId, ...(asOf ? { asOf } : {}) })}`);
