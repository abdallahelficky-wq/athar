import { api } from "./http";

function toQuery(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const getTrialBalance = (params) => api.get(`/reports/trial-balance${toQuery(params)}`);
export const getIncomeStatement = (params) => api.get(`/reports/income-statement${toQuery(params)}`);
export const getBalanceSheet = (params) => api.get(`/reports/balance-sheet${toQuery(params)}`);

export const getCustomerStatement = (customerId, params) =>
  api.get(`/reports/customer-statement/${customerId}${toQuery(params)}`);
export const getSupplierStatement = (supplierId, params) =>
  api.get(`/reports/supplier-statement/${supplierId}${toQuery(params)}`);
