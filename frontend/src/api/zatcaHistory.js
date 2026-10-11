import { api } from "./http";

// basePath: "/sales-invoices" | "/sales-returns" | "/sales-debit-notes"
export const getZatcaHistory = (basePath, id) => api.get(`${basePath}/${id}/zatca-history`);
export const getZatcaAttemptXmlBlob = (basePath, id, attemptId) => api.getBlob(`${basePath}/${id}/zatca-attempts/${attemptId}/xml`);
export const reissueRejectedZatcaDocument = (basePath, id) => api.post(`${basePath}/${id}/reissue-zatca`);
