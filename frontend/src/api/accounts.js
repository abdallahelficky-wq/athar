import { api } from "./http";

export const listAccounts = () => api.get("/accounts");
export const createAccount = (payload) => api.post("/accounts", payload);
export const updateAccount = (id, payload) => api.patch(`/accounts/${id}`, payload);
export const deleteAccount = (id) => api.delete(`/accounts/${id}`);
