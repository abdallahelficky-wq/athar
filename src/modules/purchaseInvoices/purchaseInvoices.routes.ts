import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPurchaseInvoiceSchema, updatePurchaseInvoiceSchema, unpostSchema } from "./purchaseInvoices.schemas";
import { listHandler, getHandler, createHandler, updateHandler, deleteHandler, postHandler, unpostHandler } from "./purchaseInvoices.controller";

export const purchaseInvoiceRoutes = Router();
purchaseInvoiceRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

purchaseInvoiceRoutes.get("/", requirePositionAction("purchaseInvoices", "read"), listHandler);
purchaseInvoiceRoutes.get("/:id", requirePositionAction("purchaseInvoices", "read"), getHandler);
purchaseInvoiceRoutes.post("/", requirePositionAction("purchaseInvoices", "create"), requirePositionAction("purchaseInvoices", "approve"), canWrite, validateBody(createPurchaseInvoiceSchema), createHandler);
purchaseInvoiceRoutes.patch("/:id", requirePositionAction("purchaseInvoices", "edit"), canWrite, validateBody(updatePurchaseInvoiceSchema), updateHandler);
purchaseInvoiceRoutes.delete("/:id", requirePositionAction("purchaseInvoices", "delete"), canWrite, deleteHandler);
purchaseInvoiceRoutes.post("/:id/post", requirePositionAction("purchaseInvoices", "approve"), canWrite, postHandler);
purchaseInvoiceRoutes.post("/:id/unpost", requirePositionAction("purchaseInvoices", "approve"), canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
