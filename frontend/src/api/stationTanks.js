import { api } from "./http";

// موديول الخزانات والتوريد — راجع src/modules/stationTanks
const qs = (params) => Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export const listTanks = (companyId) => api.get(`/station-tanks/tanks?${qs({ companyId })}`);
export const createTank = (payload) => api.post("/station-tanks/tanks", payload);
export const updateTank = (id, payload) => api.patch(`/station-tanks/tanks/${id}`, payload);
export const setNozzleTank = (nozzleId, tankId) => api.put(`/station-tanks/nozzles/${nozzleId}/tank`, { tankId });

export const listReadings = (companyId, filter = {}) => api.get(`/station-tanks/readings?${qs({ companyId, ...filter })}`);
export const createReading = (payload) => api.post("/station-tanks/readings", payload);
export const voidReading = (id, reason) => api.post(`/station-tanks/readings/${id}/void`, { reason });

export const listDeliveries = (companyId, filter = {}) => api.get(`/station-tanks/deliveries?${qs({ companyId, ...filter })}`);
export const createDelivery = (payload) => api.post("/station-tanks/deliveries", payload);
export const voidDelivery = (id, reason) => api.post(`/station-tanks/deliveries/${id}/void`, { reason });

export const reconcile = (companyId, from, to, costCenterId) => api.get(`/station-tanks/reconciliation?${qs({ companyId, from, to, costCenterId })}`);
