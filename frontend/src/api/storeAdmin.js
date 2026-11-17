import { api } from "./http";

// إعدادات المتجر الإلكتروني التي لها جداولها — مناطق الشحن وكوبونات الخصم (راجع src/modules/storeAdmin في الخادم)
export const listShippingZones = (companyId) => api.get(`/store-admin/shipping-zones?companyId=${companyId}`);
export const createShippingZone = (payload) => api.post("/store-admin/shipping-zones", payload);
export const updateShippingZone = (id, payload) => api.patch(`/store-admin/shipping-zones/${id}`, payload);
export const deleteShippingZone = (id) => api.delete(`/store-admin/shipping-zones/${id}`);

export const listStoreCoupons = (companyId) => api.get(`/store-admin/coupons?companyId=${companyId}`);
export const createStoreCoupon = (payload) => api.post("/store-admin/coupons", payload);
export const updateStoreCoupon = (id, payload) => api.patch(`/store-admin/coupons/${id}`, payload);
export const deleteStoreCoupon = (id) => api.delete(`/store-admin/coupons/${id}`);

/** رابط خلاصة المنتجات (CSV) الذي يُلصَق في كتالوج Meta — عام بلا مصادقة. */
export const storeFeedUrl = (slug) => `${import.meta.env.VITE_API_URL || "http://localhost:4000/api"}/store/${slug}/feed.csv`;
