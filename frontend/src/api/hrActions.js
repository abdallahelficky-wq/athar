import { api } from "./http";

export const listHrActions = (companyId, month) => api.get(`/hr-actions?companyId=${companyId}&month=${month}`);
export const createHrActionBatch = (payload) => api.post("/hr-actions", payload);
export const deleteHrAction = (id) => api.delete(`/hr-actions/${id}`);
