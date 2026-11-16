import { api } from "./http";

export const listStoreOrders = (companyId, status) => {
  const query = new URLSearchParams({ companyId });
  if (status) query.set("status", status);
  return api.get(`/store-orders?${query}`);
};
export const updateStoreOrderStatus = (id, status) => api.patch(`/store-orders/${id}/status`, { status });
