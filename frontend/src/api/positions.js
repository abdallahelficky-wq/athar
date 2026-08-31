import { api } from "./http";

export const listPositions = () => api.get("/positions");
export const listAssignableUsers = () => api.get("/positions/assignable-users");
export const createPosition = (payload) => api.post("/positions", payload);
export const updatePosition = (id, payload) => api.patch(`/positions/${id}`, payload);
export const deletePosition = (id) => api.delete(`/positions/${id}`);
export const assignMember = (positionId, userId) => api.post(`/positions/${positionId}/members`, { userId });
export const removeMember = (positionId, userId) => api.delete(`/positions/${positionId}/members/${userId}`);
