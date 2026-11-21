import { api } from "./http";

const enc = encodeURIComponent;

export const listBudgets = (companyId) => api.get(`/budgets?companyId=${enc(companyId)}`);
export const getBudget = (id) => api.get(`/budgets/${enc(id)}`);
export const createBudget = (payload) => api.post("/budgets", payload);
export const updateBudget = (id, payload) => api.put(`/budgets/${enc(id)}`, payload);
export const setBudgetStatus = (id, status) => api.post(`/budgets/${enc(id)}/status`, { status });
export const deleteBudget = (id) => api.delete(`/budgets/${enc(id)}`);
export const getBudgetReport = (id, through) => api.get(`/budgets/${enc(id)}/report${through ? `?through=${through}` : ""}`);
export const suggestBudget = ({ companyId, sourceStartMonth, growthPct, costCenterId }) => {
  const q = new URLSearchParams({ companyId, sourceStartMonth, growthPct: String(growthPct || 0) });
  if (costCenterId) q.set("costCenterId", costCenterId);
  return api.get(`/budgets/suggest?${q}`);
};
