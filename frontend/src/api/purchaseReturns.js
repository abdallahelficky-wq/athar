import { api } from "./http";

export const listPurchaseReturns = (companyId) => api.get(`/purchase-returns?companyId=${companyId}`);
export const createPurchaseReturn = (payload) => api.post("/purchase-returns", payload);
export const deletePurchaseReturn = (id) => api.delete(`/purchase-returns/${id}`);
export const postPurchaseReturn = (id) => api.post(`/purchase-returns/${id}/post`);
export const unpostPurchaseReturn = (id, pin) => api.post(`/purchase-returns/${id}/unpost`, { pin });
