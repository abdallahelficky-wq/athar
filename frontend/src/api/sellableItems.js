import { api } from "./http";

export const listSellableItems = (companyId) => api.get(`/sellable-items?companyId=${companyId}`);
export const createSellableItem = (payload) => api.post("/sellable-items", payload);
export const updateSellableItem = (id, payload) => api.patch(`/sellable-items/${id}`, payload);
export const deleteSellableItem = (id) => api.delete(`/sellable-items/${id}`);
