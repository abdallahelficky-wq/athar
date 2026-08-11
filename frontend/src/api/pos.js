import { api } from "./http";

export const getQuickAccessItems = (companyId) => api.get(`/pos/quick-items?companyId=${companyId}`);
export const createPosSale = (payload) => api.post("/pos/sales", payload);
