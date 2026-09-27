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

purchaseReturnRoutes.get("/", listHandler);
purchaseReturnRoutes.post("/", canWrite, validateBody(createPurchaseReturnSchema), createHandler);
purchaseReturnRoutes.delete("/:id", canWrite, deleteHandler);
purchaseReturnRoutes.post("/:id/post", canWrite, postHandler);
purchaseReturnRoutes.post("/:id/unpost", canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
