import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPurchaseReturnSchema, unpostSchema } from "./purchaseReturns.schemas";
import { listHandler, createHandler, deleteHandler, postHandler, unpostHandler } from "./purchaseReturns.controller";

export const purchaseReturnRoutes = Router();
purchaseReturnRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

purchaseReturnRoutes.get("/", requirePositionAction("purchaseReturns", "read"), listHandler);
purchaseReturnRoutes.post("/", requirePositionAction("purchaseReturns", "create"), requirePositionAction("purchaseReturns", "approve"), canWrite, validateBody(createPurchaseReturnSchema), createHandler);
purchaseReturnRoutes.delete("/:id", requirePositionAction("purchaseReturns", "delete"), canWrite, deleteHandler);
purchaseReturnRoutes.post("/:id/post", requirePositionAction("purchaseReturns", "approve"), canWrite, postHandler);
purchaseReturnRoutes.post("/:id/unpost", requirePositionAction("purchaseReturns", "approve"), canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
