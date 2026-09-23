import { api } from "./http";

export const listStockMovements = (companyId) => api.get(`/stock-movements?companyId=${companyId}`);
export const getStockBalance = (itemId, warehouseId) => api.get(`/stock-movements/balance?itemId=${itemId}&warehouseId=${warehouseId}`);
export const createInOutMovement = (payload) => api.post("/stock-movements/in-out", payload);
export const createIssueMovement = (payload) => api.post("/stock-movements/issue", payload);
export const createTransferMovement = (payload) => api.post("/stock-movements/transfer", payload);
export const removeStockMovement = (id, pin) => api.delete(`/stock-movements/${id}`, { pin });
export const getStockReport = (companyId) => api.get(`/inventory-reports/stock-report?companyId=${companyId}`);

// كرت صنف للقراءة فقط — راجع GET /stock-movements/item-card/:itemId بالخادم. from/to اختياريان
// (بصيغة YYYY-MM-DD)؛ بلا أي منهما تُعرَض كل الحركات المُسجَّلة منذ إنشاء الصنف.
export const getItemCard = (itemId, { companyId, from, to } = {}) => {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  return api.get(`/stock-movements/item-card/${itemId}?${query.toString()}`);
};
