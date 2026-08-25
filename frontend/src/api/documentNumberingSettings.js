import { api } from "./http";

export const getDocumentNumberingSettings = (companyId, docType) =>
  api.get(`/companies/${companyId}/document-numbering-settings/${docType}`);

export const updateDocumentNumberingSettings = (companyId, docType, payload) =>
  api.patch(`/companies/${companyId}/document-numbering-settings/${docType}`, payload);
