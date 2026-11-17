import { Router } from "express";
import { publicRateLimit } from "../../lib/publicRateLimit";
import { listStores, getStore, listProducts, getProduct, getProductImage, requestOtp, verifyOtp, getMe, updateMe, createOrder, listMyOrders, quoteOrder, getStoreLogo, getProductFeed } from "./store.controller";

/**
 * مسارات المتجر الإلكتروني العامة — بلا مصادقة مستخدم أثر عمداً (زائر المتجر وعميله ليسا مستخدمَين في أثر).
 *  - القراءة (الكتالوج والصور): عامة تماماً.
 *  - حساب العميل: رمز لمرة واحدة على الجوال ثم رمز دخول خاص بعملاء المتجر (storeAuth.service.ts)، بسرّ منفصل.
 *  - الطلب: يُسجَّل للزائر أو للعميل؛ الخادم يحسب أسعاره من الأصناف المنشورة (storeOrders.service.ts).
 * إدارة المتجر (تفعيله، نشر الأصناف، الصور، متابعة الطلبات) تمرّ من مسارات أثر المصادَقة لا من هنا.
 * عزل الشركة داخل store.service.ts (resolveStore ثم publishedWhere)، وresolveStore يرفض متجر شركة معلّقة الاشتراك.
 */
export const storeRoutes = Router();

storeRoutes.use(publicRateLimit({ windowMs: 60_000, max: 240 }));
// حدود أضيق لما يكتب أو يرسل رسالة: طلب الرمز والتحقق منه وإنشاء الطلب
const authLimit = publicRateLimit({ windowMs: 10 * 60_000, max: 30 });
const orderLimit = publicRateLimit({ windowMs: 10 * 60_000, max: 12 });

// دليل المتاجر المُدرَجة — قبل "/:slug"
storeRoutes.get("/", listStores);
storeRoutes.get("/:slug", getStore);
storeRoutes.get("/:slug/products", listProducts);
storeRoutes.get("/:slug/products/:code", getProduct);
storeRoutes.get("/:slug/images/:imageId", getProductImage);
storeRoutes.get("/:slug/logo", getStoreLogo);
storeRoutes.get("/:slug/feed.csv", getProductFeed);

storeRoutes.post("/:slug/auth/request-otp", authLimit, requestOtp);
storeRoutes.post("/:slug/auth/verify-otp", authLimit, verifyOtp);
storeRoutes.get("/:slug/me", getMe);
storeRoutes.patch("/:slug/me", updateMe);
storeRoutes.post("/:slug/quote", quoteOrder);
storeRoutes.post("/:slug/orders", orderLimit, createOrder);
storeRoutes.get("/:slug/orders", listMyOrders);
