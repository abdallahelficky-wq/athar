import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSalesReturnSchema, updateSalesReturnSchema, unpostSchema, sendEmailSchema } from "./salesReturns.schemas";
import {
  listHandler,
  searchHandler,
  getHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  postHandler,
  unpostHandler,
  sendEmailHandler,
  downloadPdfHandler,
  retryZatcaSubmissionHandler,
  completeZatcaPostingHandler,
} from "./salesReturns.controller";

export const salesReturnRoutes = Router();
salesReturnRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

salesReturnRoutes.get("/", requirePositionAction("salesReturns", "read"), listHandler);
// يجب أن تُسجَّل قبل GET "/:id" وإلا التقطها Express كمعرّف مردود حرفي "search" — نفس تبرير
// ترتيب /sales-invoices/search بالضبط.
salesReturnRoutes.get("/search", requirePositionAction("salesReturns", "read"), searchHandler);
salesReturnRoutes.get("/:id", requirePositionAction("salesReturns", "read"), getHandler);
salesReturnRoutes.get("/:id/pdf", requirePositionAction("salesReturns", "read"), downloadPdfHandler);
salesReturnRoutes.post("/", requirePositionAction("salesReturns", "create"), requirePositionAction("salesReturns", "approve"), canWrite, validateBody(createSalesReturnSchema), createHandler);
salesReturnRoutes.patch("/:id", requirePositionAction("salesReturns", "edit"), canWrite, validateBody(updateSalesReturnSchema), updateHandler);
salesReturnRoutes.delete("/:id", requirePositionAction("salesReturns", "delete"), canWrite, deleteHandler);
salesReturnRoutes.post("/:id/send-email", requirePositionAction("salesReturns", "edit"), canWrite, validateBody(sendEmailSchema), sendEmailHandler);
salesReturnRoutes.post("/:id/post", requirePositionAction("salesReturns", "approve"), canWrite, postHandler);
salesReturnRoutes.post("/:id/unpost", requirePositionAction("salesReturns", "approve"), canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
salesReturnRoutes.post("/:id/retry-zatca-submission", requirePositionAction("salesReturns", "approve"), canWrite, retryZatcaSubmissionHandler);
salesReturnRoutes.post("/:id/complete-zatca-posting", requirePositionAction("salesReturns", "approve"), canWrite, completeZatcaPostingHandler);
