import { api } from "./http";

// متحكمات المحطات (PTS-2) — راجع src/modules/forecourt
export const listControllers = (companyId) => api.get(`/forecourt/controllers?companyId=${companyId}`);
export const createController = (payload) => api.post("/forecourt/controllers", payload);
export const updateController = (id, payload) => api.patch(`/forecourt/controllers/${id}`, payload);
export const setNozzleMap = (id, payload) => api.put(`/forecourt/controllers/${id}/nozzle-map`, payload);
export const listTransactions = (companyId, controllerId) => api.get(`/forecourt/transactions?companyId=${companyId}${controllerId ? `&controllerId=${controllerId}` : ""}`);
export const rotateSecret = (id) => api.post(`/forecourt/controllers/${id}/secret`, {});
export const connectionSettings = () => api.get("/forecourt/connection-settings");
export const listAlerts = (companyId, controllerId) => api.get(`/forecourt/alerts?companyId=${companyId}${controllerId ? `&controllerId=${controllerId}` : ""}`);
// التحكم بالمضخات عن بُعد عبر الاتصال الدائم (PumpAuthorize / PumpStop / PumpEmergencyStop)
export const authorizePump = (id, payload) => api.post(`/forecourt/controllers/${id}/pump-authorize`, payload);
export const stopPump = (id, payload) => api.post(`/forecourt/controllers/${id}/pump-stop`, payload);
export const listCommands = (companyId, controllerId) => api.get(`/forecourt/commands?companyId=${companyId}${controllerId ? `&controllerId=${controllerId}` : ""}`);
