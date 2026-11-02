import { api } from "./http";

// إعداد المحطات (المضخات والفوهات) وأسعار الوقود — راجع src/modules/stationSetup في الخادم
export const listStations = (companyId) => api.get(`/station-setup/stations?companyId=${companyId}`);
export const createPump = (payload) => api.post("/station-setup/pumps", payload);
export const retirePump = (payload) => api.post("/station-setup/pumps/retire", payload);
export const updateNozzle = (id, payload) => api.patch(`/station-setup/nozzles/${id}`, payload);
// مستودع المحطة (يُصرَف منه الوقود عند ترحيل الوردية) — warehouseId: null يفكّ الربط
export const setStationWarehouse = (costCenterId, payload) => api.put(`/station-setup/stations/${costCenterId}/warehouse`, payload);

export const listFuelPrices = (companyId) => api.get(`/station-setup/fuel-prices?companyId=${companyId}`);
export const createFuelPrice = (payload) => api.post("/station-setup/fuel-prices", payload);
export const deleteFuelPrice = (id) => api.delete(`/station-setup/fuel-prices/${id}`);
