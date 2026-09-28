import { api } from "./http";

export const getPurchasesBySupplier = (companyId) => api.get(`/purchase-reports/by-supplier?companyId=${companyId}`);
export const getPurchasesMonthly = (companyId) => api.get(`/purchase-reports/monthly?companyId=${companyId}`);
export const getPurchasesVatSummary = ({ companyId, from, to }) =>
  api.get(`/purchase-reports/vat-summary?${new URLSearchParams({ companyId, from, to })}`);
export const getPayablesAging = (companyId, asOf) => api.get(`/purchase-reports/aging?${new URLSearchParams({ companyId, ...(asOf ? { asOf } : {}) })}`);
