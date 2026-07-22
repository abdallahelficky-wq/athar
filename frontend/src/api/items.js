import { api } from "./http";

export const listItems = (companyId) => api.get(`/items?companyId=${companyId}`);
export const createItem = (payload) => api.post("/items", payload);
export const updateItem = (id, payload) => api.patch(`/items/${id}`, payload);
export const deleteItem = (id) => api.delete(`/items/${id}`);
