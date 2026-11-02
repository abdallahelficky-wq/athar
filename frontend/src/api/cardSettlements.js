import { api } from "./http";

// تسويات الشبكة (مدى) وبطاقات الوقود — راجع src/modules/cardSettlements
const qs = (params) => Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export const reconciliation = (companyId, filter) => api.get(`/card-settlements/reconciliation?${qs({ companyId, ...filter })}`);
export const listSettlements = (companyId, filter = {}) => api.get(`/card-settlements?${qs({ companyId, ...filter })}`);
export const createSettlement = (payload) => api.post("/card-settlements", payload);
export const reverseSettlement = (id, reason) => api.post(`/card-settlements/${id}/reverse`, { reason });
