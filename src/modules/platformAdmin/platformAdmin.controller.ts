import { RequestHandler } from "express";
import { methodNotAllowed } from "../../lib/httpError";
import * as service from "./platformAdmin.service";

export const listTenantsHandler: RequestHandler = async (_req, res) => {
  res.json(await service.listTenantsForPlatform());
};

export const getTenantHandler: RequestHandler = async (req, res) => {
  res.json(await service.getTenantForPlatform(req.params.id));
};

export const updateSubscriptionHandler: RequestHandler = async (req, res) => {
  res.json(await service.updateTenantSubscription(req.params.id, req.body));
};

export const updateModulesHandler: RequestHandler = async (req, res) => {
  res.json(await service.updateTenantModules(req.params.id, req.body.enabledModules));
};

export const createNoticeHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createTenantNotice(req.params.id, req.body.message));
};

export const listNoticesHandler: RequestHandler = async (req, res) => {
  res.json(await service.listTenantNotices(req.params.id));
};

export const deleteNoticeHandler: RequestHandler = async (req, res) => {
  await service.deleteTenantNotice(req.params.id, req.params.noticeId);
  res.status(204).send();
};

export const updateAdminEmailHandler: RequestHandler = async (req, res) => {
  res.json(await service.updateTenantAdminEmail(req.params.id, req.body.adminEmail));
};

/**
 * حذف المستأجر أُزيل: كان يحذف كل دفاتر الشركة وسجل تدقيقها معاً (Cascade)، ولا سياسة احتفاظ مُقرَّة
 * بعد. إجراء الحذف (بعد انقضاء مدة الاحتفاظ) يأتي لاحقاً كعملية مستقلة مقصودة؛ حتى ذلك الحين لا مسار
 * يحذف مستأجراً، ويُعيد هذا المسار 405 صريحاً لأي طلب.
 */
export const deleteTenantHandler: RequestHandler = async () => {
  throw methodNotAllowed("حذف الشركة (المستأجر) غير متاح");
};
