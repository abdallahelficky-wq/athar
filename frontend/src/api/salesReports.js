import { api } from "./http";

const range = ({ from, to, branchId } = {}) => Object.fromEntries(Object.entries({ from, to, branchId }).filter(([, v]) => v));
export const getSalesByCustomer = (companyId, r) => api.get(`/sales-reports/by-customer?${new URLSearchParams({ companyId, ...range(r) })}`);
export const getSalesMonthly = (companyId, r) => api.get(`/sales-reports/monthly?${new URLSearchParams({ companyId, ...range(r) })}`);
export const getSalesByItem = (companyId, r) => api.get(`/sales-reports/by-item?${new URLSearchParams({ companyId, ...range(r) })}`);
export const getSalesByBranch = (companyId, r) => api.get(`/sales-reports/by-branch?${new URLSearchParams({ companyId, ...range(r) })}`);
export const getSalesVatSummary = ({ companyId, from, to }) =>
  api.get(`/sales-reports/vat-summary?${new URLSearchParams({ companyId, from, to })}`);
export const getReceivablesAging = (companyId, asOf) => api.get(`/sales-reports/aging?${new URLSearchParams({ companyId, ...(asOf ? { asOf } : {}) })}`);
