import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createFixedAssetSchema, updateFixedAssetSchema, disposeFixedAssetSchema, removeSchema } from "./fixedAssets.schemas";
import { listHandler, createHandler, updateHandler, removeHandler, disposeHandler, summaryHandler } from "./fixedAssets.controller";

export const fixedAssetRoutes = Router();
fixedAssetRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

fixedAssetRoutes.get("/reports/summary", requirePositionAction("fixedAssets", "read"), summaryHandler);
fixedAssetRoutes.get("/", requirePositionAction("fixedAssets", "read"), listHandler);
fixedAssetRoutes.post("/", requirePositionAction("fixedAssets", "create"), requirePositionAction("fixedAssets", "approve"), canWrite, validateBody(createFixedAssetSchema), createHandler);
fixedAssetRoutes.patch("/:id", requirePositionAction("fixedAssets", "edit"), canWrite, validateBody(updateFixedAssetSchema), updateHandler);
fixedAssetRoutes.delete("/:id", requirePositionAction("fixedAssets", "delete"), canWrite, canUnpost, validateBody(removeSchema), removeHandler);
fixedAssetRoutes.post("/:id/dispose", requirePositionAction("fixedAssets", "approve"), canWrite, validateBody(disposeFixedAssetSchema), disposeHandler);
