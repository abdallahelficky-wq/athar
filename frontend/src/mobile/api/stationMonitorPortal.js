import { employeePortalApi } from "./employeePortalHttp";

// مشرف المحطات (بوابة الموظف) — قراءة فقط: كل محطات شركته، والشاشة الحيّة لمحطة
export const listStations = () => employeePortalApi.get("/employee-portal/station-monitor");
export const getStationLive = (costCenterId) => employeePortalApi.get(`/employee-portal/station-monitor/${costCenterId}/live`);
export const listMessages = (costCenterId) => employeePortalApi.get(`/employee-portal/station-monitor/${costCenterId}/messages`);
export const sendMessage = (costCenterId, body) => employeePortalApi.post(`/employee-portal/station-monitor/${costCenterId}/messages`, { body });
