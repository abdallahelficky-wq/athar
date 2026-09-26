import { employeePortalApi } from "./employeePortalHttp";

// محور العامل فقط (بوابة الموظف) — شاشة المحاسب منفصلة تماماً في التطبيق الرئيسي
// (frontend/src/api/stationShifts.js)، مسار API مختلف تماماً ومصادقة مختلفة تماماً.
export const getMyStation = () => employeePortalApi.get("/employee-portal/station-shifts/my-station");
export const openShift = (shiftType) => employeePortalApi.post("/employee-portal/station-shifts", { shiftType });
export const submitReading = (shiftId, payload) => employeePortalApi.post(`/employee-portal/station-shifts/${shiftId}/readings`, payload);
export const uploadReadingPhoto = (shiftId, readingId, file) => {
  const form = new FormData();
  form.append("file", file);
  return employeePortalApi.postForm(`/employee-portal/station-shifts/${shiftId}/readings/${readingId}/photo`, form);
};
export const updateCollections = (shiftId, payload) => employeePortalApi.put(`/employee-portal/station-shifts/${shiftId}/collections`, payload);
export const addExpense = (shiftId, payload) => employeePortalApi.post(`/employee-portal/station-shifts/${shiftId}/expenses`, payload);
export const uploadExpensePhoto = (shiftId, expenseId, file) => {
  const form = new FormData();
  form.append("file", file);
  return employeePortalApi.postForm(`/employee-portal/station-shifts/${shiftId}/expenses/${expenseId}/photo`, form);
};
export const getShiftSummary = (shiftId) => employeePortalApi.get(`/employee-portal/station-shifts/${shiftId}/summary`);
export const submitShift = (shiftId) => employeePortalApi.post(`/employee-portal/station-shifts/${shiftId}/submit`);
