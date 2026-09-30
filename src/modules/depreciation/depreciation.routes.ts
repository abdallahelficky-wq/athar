import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createDepreciationRunSchema, removeSchema } from "./depreciation.schemas";
import { listHandler, previewHandler, createHandler, removeHandler } from "./depreciation.controller";

export const depreciationRunRoutes = Router();
depreciationRunRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

depreciationRunRoutes.get("/", requirePositionAction("depreciation", "read"), listHandler);
depreciationRunRoutes.get("/preview", requirePositionAction("depreciation", "read"), previewHandler);
depreciationRunRoutes.post("/", requirePositionAction("depreciation", "create"), requirePositionAction("depreciation", "approve"), canWrite, validateBody(createDepreciationRunSchema), createHandler);
depreciationRunRoutes.delete("/:id", requirePositionAction("depreciation", "delete"), canWrite, canUnpost, validateBody(removeSchema), removeHandler);
