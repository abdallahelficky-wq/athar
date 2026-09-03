import { api, apiFetch } from "./http";

export const registerTenant = (payload) => apiFetch("/auth/register", { method: "POST", body: payload });
export const login = (payload) => apiFetch("/auth/login", { method: "POST", body: payload });
export const logout = (refreshToken) => apiFetch("/auth/logout", { method: "POST", body: { refreshToken } });
export const changeUnlockPin = (payload) => api.patch("/auth/unlock-pin", payload);
export const updateTenantName = (name) => api.patch("/auth/tenant", { name });
export const getMe = () => api.get("/auth/me");
export const updateMyName = (name) => api.patch("/auth/me", { name });
export const inviteUser = (payload) => api.post("/auth/invite", payload);
export const listUsers = () => api.get("/auth/users");
export const resendInvite = (userId) => api.post(`/auth/users/${userId}/resend-invite`);
export const setUserActive = (userId, active) => api.patch(`/auth/users/${userId}/active`, { active });
export const deleteUser = (userId) => api.delete(`/auth/users/${userId}`);
export const acceptInvite = (payload) => api.post("/auth/accept-invite", payload);
export const forgotPassword = (email) => api.post("/auth/forgot-password", { email });
export const resetPassword = (token, password) => api.post("/auth/reset-password", { token, password });
