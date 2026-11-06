import { api } from "./http";

const range = ({ from, to, branchId } = {}) => Object.fromEntries(Object.entries({ from, to, branchId }).filter(([, v]) => v));
export const getPurchasesBySupplier = (companyId, r) => api.get(`/purchase-reports/by-supplier?${new URLSearchParams({ companyId, ...range(r) })}`);
export const getPurchasesMonthly = (companyId, r) => api.get(`/purchase-reports/monthly?${new URLSearchParams({ companyId, ...range(r) })}`);
export const getPurchasesByItem = (companyId, r) => api.get(`/purchase-reports/by-item?${new URLSearchParams({ companyId, ...range(r) })}`);
export const getPurchasesVatSummary = ({ companyId, from, to }) =>
  api.get(`/purchase-reports/vat-summary?${new URLSearchParams({ companyId, from, to })}`);
export const getPayablesAging = (companyId, asOf) => api.get(`/purchase-reports/aging?${new URLSearchParams({ companyId, ...(asOf ? { asOf } : {}) })}`);
