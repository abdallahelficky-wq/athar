import { api } from "./http";

export const listItems = (companyId, filters = {}) => {
  const query = new URLSearchParams({ companyId });
  if (filters.type) query.set("type", filters.type);
  if (filters.search) query.set("search", filters.search);
  return api.get(`/items?${query}`);
};
export const getItem = (id) => api.get(`/items/${id}`);
export const getItemByBarcode = (companyId, barcode) =>
  api.get(`/items/by-barcode?${new URLSearchParams({ companyId, barcode })}`);
export const createItem = (payload) => api.post("/items", payload);
export const updateItem = (id, payload) => api.patch(`/items/${id}`, payload);
export const deleteItem = (id) => api.delete(`/items/${id}`);

export const getItemComponents = (id) => api.get(`/items/${id}/components`);
export const setItemComponents = (id, components) => api.put(`/items/${id}/components`, { components });
