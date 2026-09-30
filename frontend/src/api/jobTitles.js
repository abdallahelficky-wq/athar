import { api } from "./http";

export const listJobTitles = () => api.get("/job-titles");
export const createJobTitle = (name) => api.post("/job-titles", { name });
export const renameJobTitle = (id, name) => api.patch(`/job-titles/${id}`, { name });
export const deleteJobTitle = (id) => api.delete(`/job-titles/${id}`);
