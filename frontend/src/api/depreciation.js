import { api } from "./http";

export const listDepreciationRuns = (companyId) => api.get(`/depreciation-runs?companyId=${companyId}`);
export const previewDepreciation = (companyId, month) => api.get(`/depreciation-runs/preview?companyId=${companyId}&month=${month}`);
export const postDepreciationRun = (companyId, month) => api.post("/depreciation-runs", { companyId, month });
export const removeDepreciationRun = (id, pin) => api.delete(`/depreciation-runs/${id}`, { pin });
