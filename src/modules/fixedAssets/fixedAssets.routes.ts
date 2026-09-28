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

fixedAssetRoutes.get("/reports/summary", summaryHandler);
fixedAssetRoutes.get("/", listHandler);
fixedAssetRoutes.post("/", canWrite, validateBody(createFixedAssetSchema), createHandler);
fixedAssetRoutes.patch("/:id", canWrite, validateBody(updateFixedAssetSchema), updateHandler);
fixedAssetRoutes.delete("/:id", canWrite, canUnpost, validateBody(removeSchema), removeHandler);
fixedAssetRoutes.post("/:id/dispose", canWrite, validateBody(disposeFixedAssetSchema), disposeHandler);
