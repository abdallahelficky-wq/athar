import { api } from "./http";

export const listCostCenters = () => api.get("/cost-centers");
export const createCostCenter = (payload) => api.post("/cost-centers", payload);
export const updateCostCenter = (id, payload) => api.patch(`/cost-centers/${id}`, payload);
export const deleteCostCenter = (id) => api.delete(`/cost-centers/${id}`);
