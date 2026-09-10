import { api } from "./http";
const q = (companyId) => `?companyId=${encodeURIComponent(companyId)}`;
export const stableApi = {
  listBoardingOwners: (c) => api.get(`/stables/boarding-billing/owners${q(c)}`),
  createBoardingInvoice: (v) => api.post("/stables/boarding-billing/invoices", v),
  trainerCommissionReport: (c, from, to) => api.get(`/stables/trainer-commissions/report?companyId=${encodeURIComponent(c)}&from=${encodeURIComponent(from || "")}&to=${encodeURIComponent(to || "")}`),
  overview: (c) => api.get(`/stables/overview${q(c)}`),
  listStables: (c) => api.get(`/stables${q(c)}`), createStable: (v) => api.post("/stables", v), updateStable: (id, v) => api.patch(`/stables/${id}`, v), deleteStable: (id) => api.delete(`/stables/${id}`),
  listStalls: (c) => api.get(`/stables/stalls/list${q(c)}`), createStall: (v) => api.post("/stables/stalls", v), updateStall: (id, v) => api.patch(`/stables/stalls/${id}`, v), deleteStall: (id) => api.delete(`/stables/stalls/${id}`),
  listHorses: (c) => api.get(`/stables/horses/list${q(c)}`), createHorse: (v) => api.post("/stables/horses", v), updateHorse: (id, v) => api.patch(`/stables/horses/${id}`, v), deleteHorse: (id) => api.delete(`/stables/horses/${id}`),
  listContracts: (c) => api.get(`/stables/contracts/list${q(c)}`), createContract: (v) => api.post("/stables/contracts", v), updateContract: (id, v) => api.patch(`/stables/contracts/${id}`, v), deleteContract: (id) => api.delete(`/stables/contracts/${id}`),
  downloadContract: (id) => api.getBlob(`/stables/contracts/${id}/pdf`), sendContract: (id, email) => api.post(`/stables/contracts/${id}/send-email`, { email }),
  listCare: (c) => api.get(`/stables/care/list${q(c)}`), createCare: (v) => api.post("/stables/care", v), updateCare: (id, v) => api.patch(`/stables/care/${id}`, v), deleteCare: (id) => api.delete(`/stables/care/${id}`),
  listTrainers:(c)=>api.get(`/stables/trainers/list${q(c)}`),createTrainer:(v)=>api.post("/stables/trainers",v),updateTrainer:(id,v)=>api.patch(`/stables/trainers/${id}`,v),deleteTrainer:(id)=>api.delete(`/stables/trainers/${id}`),
  listLessonTypes:(c)=>api.get(`/stables/lesson-types/list${q(c)}`),createLessonType:(v)=>api.post("/stables/lesson-types",v),updateLessonType:(id,v)=>api.patch(`/stables/lesson-types/${id}`,v),deleteLessonType:(id)=>api.delete(`/stables/lesson-types/${id}`),
  listLessons:(c)=>api.get(`/stables/lessons/list${q(c)}`),createLesson:(v)=>api.post("/stables/lessons",v),updateLesson:(id,v)=>api.patch(`/stables/lessons/${id}`,v),deleteLesson:(id)=>api.delete(`/stables/lessons/${id}`),createLessonInvoice:(id)=>api.post(`/stables/lessons/${id}/invoice`),
  listCompetitions:(c)=>api.get(`/stables/competitions/list${q(c)}`),createCompetition:(v)=>api.post("/stables/competitions",v),updateCompetition:(id,v)=>api.patch(`/stables/competitions/${id}`,v),deleteCompetition:(id)=>api.delete(`/stables/competitions/${id}`),
  listServices:(c)=>api.get(`/stables/care-services/list${q(c)}`),createService:(v)=>api.post("/stables/care-services",v),updateService:(id,v)=>api.patch(`/stables/care-services/${id}`,v),deleteService:(id)=>api.delete(`/stables/care-services/${id}`),
};
