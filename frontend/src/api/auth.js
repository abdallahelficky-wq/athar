import { api, apiFetch } from "./http";

export const registerTenant = (payload) => apiFetch("/auth/register", { method: "POST", body: payload });
export const login = (payload) => apiFetch("/auth/login", { method: "POST", body: payload });
export const logout = (refreshToken) => apiFetch("/auth/logout", { method: "POST", body: { refreshToken } });
export const changeUnlockPin = (payload) => api.patch("/auth/unlock-pin", payload);
export const updateTenantName = (name) => api.patch("/auth/tenant", { name });
export const inviteUser = (payload) => api.post("/auth/invite", payload);
export const acceptInvite = (payload) => api.post("/auth/accept-invite", payload);
