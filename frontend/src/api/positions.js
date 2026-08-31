import { api } from "./http";

export const listPositions = () => api.get("/positions");
export const listAssignableUsers = () => api.get("/positions/assignable-users");
export const createPosition = (payload) => api.post("/positions", payload);
export const updatePosition = (id, payload) => api.patch(`/positions/${id}`, payload);
export const deletePosition = (id) => api.delete(`/positions/${id}`);
export const assignMember = (positionId, userId) => api.post(`/positions/${positionId}/members`, { userId });
export const removeMember = (positionId, userId) => api.delete(`/positions/${positionId}/members/${userId}`);
export const updatePositionActionPermission = (positionId, payload) => api.patch(`/positions/${positionId}/action-permissions`, payload);
export const listUserOverrides = () => api.get("/positions/user-overrides");
export const upsertUserOverride = (payload) => api.put("/positions/user-overrides", payload);
export const deleteUserOverride = (id) => api.delete(`/positions/user-overrides/${id}`);
