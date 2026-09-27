import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createReceiptSchema, unpostSchema, addAllocationSchema } from "./receipts.schemas";
import {
  listHandler,
  outstandingInvoicesHandler,
  createHandler,
  deleteHandler,
  postHandler,
  unpostHandler,
  addAllocationHandler,
  removeAllocationHandler,
} from "./receipts.controller";

export const receiptRoutes = Router();
receiptRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

receiptRoutes.get("/", listHandler);
receiptRoutes.get("/outstanding-invoices/:customerId", outstandingInvoicesHandler);
receiptRoutes.post("/", canWrite, validateBody(createReceiptSchema), createHandler);
receiptRoutes.delete("/:id", canWrite, deleteHandler);
receiptRoutes.post("/:id/post", canWrite, postHandler);
receiptRoutes.post("/:id/unpost", canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
receiptRoutes.post("/:id/allocations", canWrite, validateBody(addAllocationSchema), addAllocationHandler);
receiptRoutes.delete("/:id/allocations/:invoiceId", canWrite, removeAllocationHandler);
