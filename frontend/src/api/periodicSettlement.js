import { api } from "./http";

export const listSettlementCandidates = (companyId) => api.get(`/periodic-settlement/candidates?companyId=${companyId}`);
export const createSettlement = (payload) => api.post("/periodic-settlement", payload);
