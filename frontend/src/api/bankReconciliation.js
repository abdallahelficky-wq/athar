import { api } from "./http";

const enc = encodeURIComponent;

export const listBankStatements = ({ companyId, accountId }) =>
  api.get(`/bank-reconciliation/statements?companyId=${enc(companyId)}${accountId ? `&accountId=${enc(accountId)}` : ""}`);
export const createBankStatement = (payload) => api.post("/bank-reconciliation/statements", payload);
export const getBankStatement = (id) => api.get(`/bank-reconciliation/statements/${enc(id)}`);
export const autoMatchBankStatement = (id) => api.post(`/bank-reconciliation/statements/${enc(id)}/auto-match`);
export const matchBankLine = (id, lineId, journalEntryLineId) =>
  api.post(`/bank-reconciliation/statements/${enc(id)}/lines/${enc(lineId)}/match`, { journalEntryLineId });
export const unmatchBankLine = (id, lineId) => api.post(`/bank-reconciliation/statements/${enc(id)}/lines/${enc(lineId)}/unmatch`);
export const reconcileBankStatement = (id) => api.post(`/bank-reconciliation/statements/${enc(id)}/reconcile`);
export const reopenBankStatement = (id) => api.post(`/bank-reconciliation/statements/${enc(id)}/reopen`);
export const deleteBankStatement = (id) => api.delete(`/bank-reconciliation/statements/${enc(id)}`);
