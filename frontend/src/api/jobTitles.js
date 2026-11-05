import { api } from "./http";

export const listJobTitles = () => api.get("/job-titles");
export const createJobTitle = (name, nameEn) => api.post("/job-titles", { name, nameEn: nameEn || null });
export const renameJobTitle = (id, name, nameEn) => api.patch(`/job-titles/${id}`, { name, nameEn: nameEn || null });
export const deleteJobTitle = (id) => api.delete(`/job-titles/${id}`);
