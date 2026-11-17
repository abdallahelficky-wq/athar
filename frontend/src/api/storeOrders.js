import { api } from "./http";

export const listStoreOrders = (companyId, status) => {
  const query = new URLSearchParams({ companyId });
  if (status) query.set("status", status);
  return api.get(`/store-orders?${query}`);
};
/** إصدار فاتورة مبيعات مسودة من الطلب — shippingAccountId مطلوب فقط لطلب فيه رسوم شحن. */
export const createStoreOrderInvoice = (id, shippingAccountId) => api.post(`/store-orders/${id}/invoice`, { shippingAccountId: shippingAccountId || null });
export const updateStoreOrderStatus = (id, status) => api.patch(`/store-orders/${id}/status`, { status });
