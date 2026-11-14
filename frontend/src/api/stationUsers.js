import { api } from "./http";

// مستخدمو تطبيق المحطات (عمّال ومشرفون) — مستقلون عن شئون الموظفين. راجع src/modules/stationUsers في الخادم
export const listStationUsers = (companyId) => api.get(`/station-users?companyId=${companyId}`);
export const createStationUser = (payload) => api.post("/station-users", payload);
export const updateStationUser = (id, payload) => api.patch(`/station-users/${id}`, payload);
export const archiveStationUser = (id) => api.post(`/station-users/${id}/archive`, {});
export const restoreStationUser = (id) => api.post(`/station-users/${id}/restore`, {});
export const deleteStationUser = (id) => api.delete(`/station-users/${id}`);
