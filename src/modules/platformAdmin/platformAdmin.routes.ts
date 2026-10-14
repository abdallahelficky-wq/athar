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
  companySubscriptionStatusSchema,
  companySubscriptionAddonsSchema,
  companySubscriptionsQuerySchema,
  schedulePlanPriceSchema,
} from "./platformAdmin.schemas";
import { badRequest } from "../../lib/httpError";
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

// P8: نظرة الشركات واشتراكاتها، التعليق/التفعيل، الإضافات، كتالوج الأسعار — لشاشات athar-platform-admin (P9)
platformAdminRoutes.get("/companies", async (req, res) => {
  const parsed = companySubscriptionsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw badRequest("بيانات الطلب غير صالحة", parsed.error.flatten());
  res.json(await subscriptionAdmin.listCompanySubscriptions(parsed.data));
});
platformAdminRoutes.get("/companies/:companyId/subscription", async (req, res) => {
  res.json(await subscriptionAdmin.getCompanySubscriptionDetail(req.params.companyId));
});
platformAdminRoutes.patch("/companies/:companyId/subscription/status", validateBody(companySubscriptionStatusSchema), async (req, res) => {
  res.json(await subscriptionAdmin.setCompanySubscriptionStatus(req.params.companyId, req.body.action, req.body.reason));
});
platformAdminRoutes.patch("/companies/:companyId/subscription/addons", validateBody(companySubscriptionAddonsSchema), async (req, res) => {
  res.json(await subscriptionAdmin.updateCompanySubscriptionAddons(req.params.companyId, req.body));
});
platformAdminRoutes.get("/plan-prices", async (_req, res) => {
  res.json(await subscriptionAdmin.listPlanPrices());
});
platformAdminRoutes.post("/plan-prices", validateBody(schedulePlanPriceSchema), async (req, res) => {
  res.status(201).json(await subscriptionAdmin.schedulePlanPrice(req.body));
});
platformAdminRoutes.delete("/plan-prices/:id", async (req, res) => {
  res.json(await subscriptionAdmin.deleteScheduledPlanPrice(req.params.id));
});
