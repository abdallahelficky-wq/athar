import { api } from "./http";

export const listAccounts = (filters = {}) => {
  const query = new URLSearchParams();
  if (filters.tree) query.set("tree", "true");
  if (filters.companyId) query.set("companyId", filters.companyId);
  return api.get(`/accounts${query.size ? `?${query}` : ""}`);
};
export const createAccount = (payload) => api.post("/accounts", payload);
export const updateAccount = (id, payload) => api.patch(`/accounts/${id}`, payload);
export const deleteAccount = (id) => api.delete(`/accounts/${id}`);

export const importAccounts = (payload) => api.post("/accounts/import", payload);
export const installStandardChart = (payload) => api.post("/accounts/install-standard", payload);
