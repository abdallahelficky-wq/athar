import { api } from "./http";

export const listAttachments = (entityType, entityId) =>
  api.get(`/attachments?entityType=${entityType}&entityId=${entityId}`);

export const uploadAttachment = (entityType, entityId, file) => {
  const form = new FormData();
  form.append("entityType", entityType);
  form.append("entityId", entityId);
  form.append("file", file);
  return api.postForm("/attachments", form);
};

export const deleteAttachment = (id) => api.delete(`/attachments/${id}`);
