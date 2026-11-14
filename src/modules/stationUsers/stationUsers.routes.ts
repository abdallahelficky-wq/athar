import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, assertCompanyAccess } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";
import { createStationUserSchema, updateStationUserSchema } from "./stationUsers.schemas";
import * as service from "./stationUsers.service";

/**
 * إدارة مستخدمي تطبيق المحطات من موديول المحطات (بنفس صلاحيات إعداد المحطات: stationSetup، والكتابة لـ admin/finance_manager).
 * كل مسار بمعرّف يتحقق أن المستخدم من مستأجر الطلب ثم من شركة يملك المستخدمُ الإداري الوصول إليها.
 */
export const stationUserRoutes = Router();
stationUserRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);
const canManage = requireRole("admin", "finance_manager");

const companyOf = async (tenantId: string, id: string) => {
  const u = await prisma.stationUser.findFirst({ where: { id, tenantId }, select: { companyId: true } });
  if (!u) throw notFound("مستخدم المحطات غير موجود");
  return u.companyId;
};

stationUserRoutes.get("/", requirePositionAction("stationSetup", "read"), async (req, res) => {
  const companyId = String(req.query.companyId ?? "");
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.listStationUsers(req.auth!.tenantId, companyId));
});

stationUserRoutes.post("/", requirePositionAction("stationSetup", "create"), canManage, validateBody(createStationUserSchema), async (req, res) => {
  assertCompanyAccess(req.auth!, req.body.companyId);
  res.status(201).json(await service.createStationUser(req.auth!.tenantId, req.body));
});

stationUserRoutes.patch("/:id", requirePositionAction("stationSetup", "edit"), canManage, validateBody(updateStationUserSchema), async (req, res) => {
  assertCompanyAccess(req.auth!, await companyOf(req.auth!.tenantId, req.params.id));
  res.json(await service.updateStationUser(req.auth!.tenantId, req.params.id, req.body));
});

stationUserRoutes.post("/:id/archive", requirePositionAction("stationSetup", "edit"), canManage, async (req, res) => {
  assertCompanyAccess(req.auth!, await companyOf(req.auth!.tenantId, req.params.id));
  res.json(await service.archiveStationUser(req.auth!.tenantId, req.params.id));
});

stationUserRoutes.post("/:id/restore", requirePositionAction("stationSetup", "edit"), canManage, async (req, res) => {
  assertCompanyAccess(req.auth!, await companyOf(req.auth!.tenantId, req.params.id));
  res.json(await service.restoreStationUser(req.auth!.tenantId, req.params.id));
});

stationUserRoutes.delete("/:id", requirePositionAction("stationSetup", "delete"), canManage, async (req, res) => {
  assertCompanyAccess(req.auth!, await companyOf(req.auth!.tenantId, req.params.id));
  res.json(await service.deleteStationUser(req.auth!.tenantId, req.params.id));
});
