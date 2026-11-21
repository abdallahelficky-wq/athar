import { api } from "./http";

const enc = encodeURIComponent;

export const listCheques = ({ companyId, direction, status }) => {
  const q = new URLSearchParams({ companyId });
  if (direction) q.set("direction", direction);
  if (status) q.set("status", status);
  return api.get(`/cheques?${q}`);
};
export const createCheque = (payload) => api.post("/cheques", payload);
export const chequeAction = (id, action, payload) => api.post(`/cheques/${enc(id)}/${action}`, payload);
export const undoCheque = (id) => api.post(`/cheques/${enc(id)}/undo`);
export const getChequeSettings = (companyId) => api.get(`/cheques/settings?companyId=${enc(companyId)}`);
export const updateChequeSettings = (payload) => api.put("/cheques/settings", payload);
