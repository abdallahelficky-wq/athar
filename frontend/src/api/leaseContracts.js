import { api } from "./http";

export const listLeaseContracts = (companyId) => api.get(`/lease-contracts?companyId=${companyId}`);
export const createLeaseContract = (payload) => api.post("/lease-contracts", payload);
export const updateLeaseContract = (id, payload) => api.patch(`/lease-contracts/${id}`, payload);
export const deleteLeaseContract = (id) => api.delete(`/lease-contracts/${id}`);
