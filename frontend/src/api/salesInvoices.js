import { api } from "./http";

export const listSalesInvoices = (companyId) => api.get(`/sales-invoices?companyId=${companyId}`);

// نقطة نهاية منفصلة تماماً عن listSalesInvoices أعلاه — بحث/فلترة/ترقيم من جانب الخادم (راجع
// GET /sales-invoices/search في salesInvoices.routes.ts). params كائن مسطّح؛ أي مفتاح بقيمة
// فارغة/undefined يُستبعَد من الاستعلام (يترك الفلتر المقابل غير مُطبَّق في الخادم).
export const searchSalesInvoices = (companyId, params = {}) => {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  return api.get(`/sales-invoices/search?${query.toString()}`);
};

export const getSalesInvoice = (id) => api.get(`/sales-invoices/${id}`);
export const createSalesInvoice = (payload) => api.post("/sales-invoices", payload);
export const updateSalesInvoice = (id, payload) => api.patch(`/sales-invoices/${id}`, payload);
export const deleteSalesInvoice = (id) => api.delete(`/sales-invoices/${id}`);
export const postSalesInvoice = (id) => api.post(`/sales-invoices/${id}/post`);
export const unpostSalesInvoice = (id, pin) => api.post(`/sales-invoices/${id}/unpost`, { pin });
export const sendInvoiceEmail = (id, email) => api.post(`/sales-invoices/${id}/send-email`, email ? { email } : {});
export const resendInvoiceZatca = (id) => api.post(`/sales-invoices/${id}/resend-zatca`);

export const retryInvoiceZatcaSubmission = (id) => api.post(`/sales-invoices/${id}/retry-zatca-submission`);
