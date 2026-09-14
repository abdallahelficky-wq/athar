import { api } from "./http";

// عامل المحطة
export const getMyStation = () => api.get("/station-shifts/my-station");
export const openShift = (shiftType) => api.post("/station-shifts", { shiftType });
export const submitReading = (shiftId, payload) => api.post(`/station-shifts/${shiftId}/readings`, payload);
export const updateCollections = (shiftId, payload) => api.put(`/station-shifts/${shiftId}/collections`, payload);
export const getShiftSummary = (shiftId) => api.get(`/station-shifts/${shiftId}/summary`);
export const submitShift = (shiftId) => api.post(`/station-shifts/${shiftId}/submit`);

// المحاسب — مراجعة/اعتماد/رفض/ترحيل
export const listPendingShifts = (companyId) => api.get(`/station-shifts/pending${companyId ? `?companyId=${companyId}` : ""}`);
export const getShiftById = (shiftId) => api.get(`/station-shifts/${shiftId}`);
export const correctReading = (shiftId, readingId, accountantConfirmedValue) =>
  api.put(`/station-shifts/${shiftId}/readings/${readingId}`, { accountantConfirmedValue });
export const approveShift = (shiftId) => api.post(`/station-shifts/${shiftId}/approve`);
export const postShift = (shiftId) => api.post(`/station-shifts/${shiftId}/post`);
export const rejectShift = (shiftId, reasonCode, note) => api.post(`/station-shifts/${shiftId}/reject`, { reasonCode, note });
