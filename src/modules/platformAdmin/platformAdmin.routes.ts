import { Router } from "express";
import { authenticatePlatformService } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  updateSubscriptionSchema,
  updateModulesSchema,
  createNoticeSchema,
  updateAdminEmailSchema,
  enforcementSwitchSchema,
  companySubscriptionSchema,
  companyPosUsersSchema,
} from "./platformAdmin.schemas";
import * as subscriptionAdmin from "../subscriptions/subscriptionAdmin.service";
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
platformAdminRoutes.get("/tenants/:id/directory", controller.getTenantDirectoryHandler);
platformAdminRoutes.patch("/tenants/:id/subscription", validateBody(updateSubscriptionSchema), controller.updateSubscriptionHandler);
platformAdminRoutes.patch("/tenants/:id/modules", validateBody(updateModulesSchema), controller.updateModulesHandler);
platformAdminRoutes.patch("/tenants/:id/admin-email", validateBody(updateAdminEmailSchema), controller.updateAdminEmailHandler);
platformAdminRoutes.delete("/tenants/:id", controller.deleteTenantHandler);
platformAdminRoutes.get("/tenants/:id/notices", controller.listNoticesHandler);
platformAdminRoutes.post("/tenants/:id/notices", validateBody(createNoticeSchema), controller.createNoticeHandler);
platformAdminRoutes.delete("/tenants/:id/notices/:noticeId", controller.deleteNoticeHandler);

// إنفاذ الاشتراكات (P4) — مفتاح شامل معطّل افتراضياً، ثم شركة بعينها بـenforced=true
platformAdminRoutes.get("/subscription-enforcement", async (_req, res) => {
  res.json(await subscriptionAdmin.getEnforcementSwitch());
});
platformAdminRoutes.put("/subscription-enforcement", validateBody(enforcementSwitchSchema), async (req, res) => {
  res.json(await subscriptionAdmin.setEnforcementSwitch(req.body.enabled));
});
platformAdminRoutes.put("/companies/:companyId/subscription", validateBody(companySubscriptionSchema), async (req, res) => {
  res.json(await subscriptionAdmin.upsertCompanySubscription(req.params.companyId, req.body));
});
platformAdminRoutes.put("/companies/:companyId/pos-users", validateBody(companyPosUsersSchema), async (req, res) => {
  res.json(await subscriptionAdmin.setCompanyPosUsers(req.params.companyId, req.body.userIds));
});
