import { Router } from "express";
import { publicRateLimit } from "../../lib/publicRateLimit";
import { getStore, listProducts, getProduct, getProductImage } from "./store.controller";

/**
 * مسارات المتجر الإلكتروني العامة — GET فقط وبلا أي مصادقة عمداً (زائر المتجر ليس مستخدماً في أثر). لا يُضاف هنا
 * أي مسار كتابة: إدارة المتجر (تفعيله، نشر الأصناف، رفع الصور) تمرّ من مسارات الشركات والأصناف والمرفقات المصادَقة.
 * عزل الشركة داخل store.service.ts (resolveStore ثم publishedWhere).
 */
export const storeRoutes = Router();

storeRoutes.use(publicRateLimit({ windowMs: 60_000, max: 240 }));

storeRoutes.get("/:slug", getStore);
storeRoutes.get("/:slug/products", listProducts);
storeRoutes.get("/:slug/products/:code", getProduct);
storeRoutes.get("/:slug/images/:imageId", getProductImage);
