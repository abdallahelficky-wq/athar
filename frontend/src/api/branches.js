import { api } from "./http";

export const listBranches = (companyId) => api.get(`/branches?companyId=${companyId}`);
export const createBranch = (payload) => api.post("/branches", payload);
export const updateBranch = (id, payload) => api.patch(`/branches/${id}`, payload);
export const deleteBranch = (id) => api.delete(`/branches/${id}`);
