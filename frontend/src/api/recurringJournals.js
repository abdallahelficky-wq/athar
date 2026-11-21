import { api } from "./http";

const enc = encodeURIComponent;

export const listRecurringJournals = (companyId) => api.get(`/recurring-journals?companyId=${enc(companyId)}`);
export const getRecurringJournal = (id) => api.get(`/recurring-journals/${enc(id)}`);
export const createRecurringJournal = (payload) => api.post("/recurring-journals", payload);
export const updateRecurringJournal = (id, payload) => api.put(`/recurring-journals/${enc(id)}`, payload);
export const setRecurringJournalActive = (id, active) => api.post(`/recurring-journals/${enc(id)}/active`, { active });
export const runRecurringJournalNow = (id) => api.post(`/recurring-journals/${enc(id)}/run-now`);
export const deleteRecurringJournal = (id) => api.delete(`/recurring-journals/${enc(id)}`);
