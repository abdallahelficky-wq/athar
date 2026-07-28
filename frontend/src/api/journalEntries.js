import { api } from "./http";

function toQuery(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const listJournalEntries = (filters) => api.get(`/journal-entries${toQuery(filters)}`);
export const getJournalEntry = (id) => api.get(`/journal-entries/${id}`);
export const createJournalEntry = (payload) => api.post("/journal-entries", payload);
export const updateJournalEntry = (id, payload) => api.patch(`/journal-entries/${id}`, payload);
export const deleteJournalEntry = (id) => api.delete(`/journal-entries/${id}`);
export const postJournalEntry = (id) => api.post(`/journal-entries/${id}/post`);
export const unpostJournalEntry = (id, pin) => api.post(`/journal-entries/${id}/unpost`, { pin });
export const importJournalEntries = (companyId, rows) =>
  api.post("/journal-entries/import", { companyId, rows });
export const getMirrorSuggestion = (id, targetCompanyId) =>
  api.post(`/journal-entries/${id}/mirror-suggestion`, { targetCompanyId });
export const createMirrorJournalEntry = (id, payload) => api.post(`/journal-entries/${id}/mirror`, payload);

export const createJournalEntryFromDocument = (companyId, file) => {
  const form = new FormData();
  form.append("companyId", companyId);
  form.append("file", file);
  return api.postForm("/journal-entries/from-document", form);
};
