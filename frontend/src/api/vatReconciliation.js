import { api } from "./http";

const qs = ({ companyId, from, to }) => new URLSearchParams({ companyId, from, to }).toString();

export const getVatReconciliation = (params) => api.get(`/vat-reconciliation?${qs(params)}`);
