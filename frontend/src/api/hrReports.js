import { api } from "./http";

export const getExpiringDocuments = (companyId, withinDays = 30) =>
  api.get(`/hr-reports/expiring-documents?companyId=${companyId}&withinDays=${withinDays}`);
