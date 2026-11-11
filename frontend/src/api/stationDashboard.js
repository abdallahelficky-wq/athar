import { api } from "./http";

// لوحة إدارة محطات الوقود — راجع src/modules/stationDashboard
const qs = (params) => Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export const getOverview = (companyId, from, to) => api.get(`/station-dashboard?${qs({ companyId, from, to })}`);
export const getStation = (companyId, costCenterId, from, to) => api.get(`/station-dashboard/stations/${costCenterId}?${qs({ companyId, from, to })}`);
// الشاشة الحيّة لمحطة — حالة نقاط التعبئة والخزانات الآن من متحكمها
export const getStationLive = (companyId, costCenterId) => api.get(`/station-dashboard/stations/${costCenterId}/live?${qs({ companyId })}`);
