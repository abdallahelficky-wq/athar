import { api } from "./http";

const enc = encodeURIComponent;

export const computeZakat = ({ companyId, periodStart, periodEnd, hijriYear, method, zakatableOwnershipPct, adjustments }) => {
  const q = new URLSearchParams({ companyId, periodStart, periodEnd, hijriYear: String(Boolean(hijriYear)) });
  if (method) q.set("method", method);
  if (zakatableOwnershipPct !== undefined && zakatableOwnershipPct !== "") q.set("zakatableOwnershipPct", String(zakatableOwnershipPct));
  if (adjustments?.length) q.set("adjustments", JSON.stringify(adjustments));
  return api.get(`/zakat/compute?${q}`);
};
export const updateZakatSettings = (payload) => api.put("/zakat/settings", payload);
export const setZakatTreatment = (accountId, treatment) => api.put(`/zakat/accounts/${enc(accountId)}/treatment`, { treatment });
export const listZakatDeclarations = (companyId) => api.get(`/zakat/declarations?companyId=${enc(companyId)}`);
export const saveZakatDeclaration = (payload) => api.post("/zakat/declarations", payload);
export const postZakatDeclaration = (id, payload) => api.post(`/zakat/declarations/${enc(id)}/post`, payload);
export const deleteZakatDeclaration = (id) => api.delete(`/zakat/declarations/${enc(id)}`);
