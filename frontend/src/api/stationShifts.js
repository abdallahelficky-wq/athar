import { api } from "./http";

// شاشة المحاسب فقط (User/Position) — محور العامل انتقل بالكامل لبوابة الموظف
// (frontend/src/mobile/api/stationShiftsPortal.js)، مسار API مختلف تماماً ومصادقة مختلفة تماماً.
export const listPendingShifts = (companyId) => api.get(`/station-shifts/pending${companyId ? `?companyId=${companyId}` : ""}`);
export const getShiftById = (shiftId) => api.get(`/station-shifts/${shiftId}`);
export const correctReading = (shiftId, readingId, accountantConfirmedValue) =>
  api.put(`/station-shifts/${shiftId}/readings/${readingId}`, { accountantConfirmedValue });
export const approveShift = (shiftId) => api.post(`/station-shifts/${shiftId}/approve`);
export const postShift = (shiftId) => api.post(`/station-shifts/${shiftId}/post`);
export const rejectShift = (shiftId, reasonCode, note) => api.post(`/station-shifts/${shiftId}/reject`, { reasonCode, note });
