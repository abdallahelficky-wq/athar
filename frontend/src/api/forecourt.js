import { api } from "./http";

// متحكمات المحطات (PTS-2) — راجع src/modules/forecourt
export const listControllers = (companyId) => api.get(`/forecourt/controllers?companyId=${companyId}`);
export const createController = (payload) => api.post("/forecourt/controllers", payload);
export const updateController = (id, payload) => api.patch(`/forecourt/controllers/${id}`, payload);
export const setNozzleMap = (id, payload) => api.put(`/forecourt/controllers/${id}/nozzle-map`, payload);
export const listTransactions = (companyId, controllerId) => api.get(`/forecourt/transactions?companyId=${companyId}${controllerId ? `&controllerId=${controllerId}` : ""}`);
