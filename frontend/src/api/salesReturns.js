import { api } from "./http";

export const listSalesReturns = (companyId) => api.get(`/sales-returns?companyId=${companyId}`);
export const createSalesReturn = (payload) => api.post("/sales-returns", payload);
export const deleteSalesReturn = (id) => api.delete(`/sales-returns/${id}`);
export const postSalesReturn = (id) => api.post(`/sales-returns/${id}/post`);
export const unpostSalesReturn = (id, pin) => api.post(`/sales-returns/${id}/unpost`, { pin });
