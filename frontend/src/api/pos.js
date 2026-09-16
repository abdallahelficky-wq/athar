import { api } from "./http";

export const getQuickAccessItems = (companyId, warehouseId) =>
  api.get(`/pos/quick-items?companyId=${companyId}&warehouseId=${warehouseId}`);
export const createPosSale = (payload) => api.post("/pos/sales", payload);

export const listPosFavoriteItems = (companyId, warehouseId) =>
  api.get(`/pos/favorites?companyId=${companyId}&warehouseId=${warehouseId}`);
export const addPosFavoriteItem = (companyId, warehouseId, itemId) =>
  api.post("/pos/favorites", { companyId, warehouseId, itemId });
export const removePosFavoriteItem = (warehouseId, itemId) =>
  api.delete(`/pos/favorites/${warehouseId}/${itemId}`);
