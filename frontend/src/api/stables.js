import { api } from "./http";
const q = (companyId) => `?companyId=${encodeURIComponent(companyId)}`;
export const stableApi = {
  overview: (c) => api.get(`/stables/overview${q(c)}`),
  listStables: (c) => api.get(`/stables${q(c)}`), createStable: (v) => api.post("/stables", v), updateStable: (id, v) => api.patch(`/stables/${id}`, v), deleteStable: (id) => api.delete(`/stables/${id}`),
  listStalls: (c) => api.get(`/stables/stalls/list${q(c)}`), createStall: (v) => api.post("/stables/stalls", v), updateStall: (id, v) => api.patch(`/stables/stalls/${id}`, v), deleteStall: (id) => api.delete(`/stables/stalls/${id}`),
  listHorses: (c) => api.get(`/stables/horses/list${q(c)}`), createHorse: (v) => api.post("/stables/horses", v), updateHorse: (id, v) => api.patch(`/stables/horses/${id}`, v), deleteHorse: (id) => api.delete(`/stables/horses/${id}`),
  listContracts: (c) => api.get(`/stables/contracts/list${q(c)}`), createContract: (v) => api.post("/stables/contracts", v), updateContract: (id, v) => api.patch(`/stables/contracts/${id}`, v), deleteContract: (id) => api.delete(`/stables/contracts/${id}`),
  listCare: (c) => api.get(`/stables/care/list${q(c)}`), createCare: (v) => api.post("/stables/care", v), updateCare: (id, v) => api.patch(`/stables/care/${id}`, v), deleteCare: (id) => api.delete(`/stables/care/${id}`),
};

