import { api } from "./http";

export const listSalesReturns = (companyId) => api.get(`/sales-returns?companyId=${companyId}`);

// نقطة نهاية منفصلة تماماً عن listSalesReturns أعلاه — بحث/فلترة/ترقيم من جانب الخادم (راجع
// GET /sales-returns/search)، نفس تبرير searchSalesInvoices في api/salesInvoices.js بالضبط.
export const searchSalesReturns = (companyId, params = {}) => {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  return api.get(`/sales-returns/search?${query.toString()}`);
};

export const getSalesReturn = (id) => api.get(`/sales-returns/${id}`);
export const createSalesReturn = (payload) => api.post("/sales-returns", payload);
export const updateSalesReturn = (id, payload) => api.patch(`/sales-returns/${id}`, payload);
export const deleteSalesReturn = (id) => api.delete(`/sales-returns/${id}`);
export const postSalesReturn = (id) => api.post(`/sales-returns/${id}/post`);
export const unpostSalesReturn = (id, pin) => api.post(`/sales-returns/${id}/unpost`, { pin });
export const sendSalesReturnEmail = (id, email) => api.post(`/sales-returns/${id}/send-email`, email ? { email } : {});

export const retrySalesReturn = (id) => api.post(`/sales-returns/${id}/retry-zatca-submission`);
export const completeSalesReturn = (id) => api.post(`/sales-returns/${id}/complete-zatca-posting`);

// نفس نسخة PDF المُرسَلة بالإيميل فعلياً (راجع getSalesReturnPdf بالخادم) — راجع
// getSalesInvoicePdfBlob لنفس التبرير بالضبط.
export const getSalesReturnPdfBlob = (id) => api.getBlob(`/sales-returns/${id}/pdf`);
