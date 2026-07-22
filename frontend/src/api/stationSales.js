import { api } from "./http";

export const listStationSales = (companyId) => api.get(`/station-sales?companyId=${companyId}`);
export const createStationSale = (payload) => api.post("/station-sales", payload);
export const deleteStationSale = (id) => api.delete(`/station-sales/${id}`);
