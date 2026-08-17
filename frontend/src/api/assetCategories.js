import { api } from "./http";

export const listAssetCategories = (companyId) => api.get(`/asset-categories?companyId=${companyId}`);
export const createAssetCategory = (payload) => api.post("/asset-categories", payload);
export const updateAssetCategory = (id, payload) => api.patch(`/asset-categories/${id}`, payload);
export const removeAssetCategory = (id) => api.delete(`/asset-categories/${id}`);
