import { api } from "./http";

export const listStockMovements = (companyId) => api.get(`/stock-movements?companyId=${companyId}`);
export const getStockBalance = (itemId, warehouseId) => api.get(`/stock-movements/balance?itemId=${itemId}&warehouseId=${warehouseId}`);
export const createInOutMovement = (payload) => api.post("/stock-movements/in-out", payload);
export const createIssueMovement = (payload) => api.post("/stock-movements/issue", payload);
export const createTransferMovement = (payload) => api.post("/stock-movements/transfer", payload);
export const removeStockMovement = (id, pin) => api.delete(`/stock-movements/${id}`, { pin });
export const getStockReport = (companyId) => api.get(`/inventory-reports/stock-report?companyId=${companyId}`);
