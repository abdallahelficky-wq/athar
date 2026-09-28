import { api } from "./http";

const qs = ({ companyId, from, to }) => new URLSearchParams({ companyId, from, to }).toString();

export const getVatReconciliation = (params) => api.get(`/vat-reconciliation?${qs(params)}`);
// أرشيف مستندات زاتكا للفترة (الملحق 1) — ملف ZIP؛ الرأسان X-Archived-Count وX-Missing-Count يحملان العددين
export const exportZatcaArchive = (params) => api.getBlob(`/zatca-archive/export?${qs(params)}`);
// المستندات المقبولة منذ بدء الأرشفة بلا أصل محفوظ — يجب أن يكون صفراً
export const getUnarchivedZatcaDocuments = (companyId) => api.get(`/zatca-archive/unarchived?companyId=${encodeURIComponent(companyId)}`);
