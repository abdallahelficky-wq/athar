import { api } from "./http";

export const listFixedAssets = (companyId) => api.get(`/fixed-assets?companyId=${companyId}`);
export const getFixedAssetsSummary = (companyId) => api.get(`/fixed-assets/reports/summary?companyId=${companyId}`);
export const createFixedAsset = (payload) => api.post("/fixed-assets", payload);
export const updateFixedAsset = (id, payload) => api.patch(`/fixed-assets/${id}`, payload);
export const removeFixedAsset = (id, pin) => api.delete(`/fixed-assets/${id}`, { pin });
export const disposeFixedAsset = (id, payload) => api.post(`/fixed-assets/${id}/dispose`, payload);
