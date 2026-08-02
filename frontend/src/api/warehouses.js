import { api } from "./http";

export const listWarehouses = (companyId) => api.get(`/warehouses${companyId ? `?companyId=${companyId}` : ""}`);
export const createWarehouse = (payload) => api.post("/warehouses", payload);
export const updateWarehouse = (id, payload) => api.patch(`/warehouses/${id}`, payload);
export const deleteWarehouse = (id) => api.delete(`/warehouses/${id}`);
