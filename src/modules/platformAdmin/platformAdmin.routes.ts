import { Router } from "express";
import { authenticatePlatformService } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { updateSubscriptionSchema, updateModulesSchema, createNoticeSchema } from "./platformAdmin.schemas";
import * as controller from "./platformAdmin.controller";

/**
 * كل مسارات /api/platform-admin/* — يستدعيها حصرياً تطبيق "athar-platform-admin" المنفصل تماماً
 * (مستودع كود وقاعدة بيانات مستقلَّين)، عبر سرّ مشترك ثابت (authenticatePlatformService) لا رمز
 * JWT مستخدم عادي. نطاق ضيّق عمداً: بيانات إدارية على مستوى Tenant فقط (لا وصول لأي بيانات
 * تشغيلية داخل أي شركة).
 */
export const platformAdminRoutes = Router();
platformAdminRoutes.use(authenticatePlatformService);

platformAdminRoutes.get("/tenants", controller.listTenantsHandler);
platformAdminRoutes.get("/tenants/:id", controller.getTenantHandler);
platformAdminRoutes.patch("/tenants/:id/subscription", validateBody(updateSubscriptionSchema), controller.updateSubscriptionHandler);
platformAdminRoutes.patch("/tenants/:id/modules", validateBody(updateModulesSchema), controller.updateModulesHandler);
platformAdminRoutes.get("/tenants/:id/notices", controller.listNoticesHandler);
platformAdminRoutes.post("/tenants/:id/notices", validateBody(createNoticeSchema), controller.createNoticeHandler);
platformAdminRoutes.delete("/tenants/:id/notices/:noticeId", controller.deleteNoticeHandler);
