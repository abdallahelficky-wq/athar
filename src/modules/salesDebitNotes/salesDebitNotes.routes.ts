import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSalesDebitNoteSchema, unpostSchema } from "./salesDebitNotes.schemas";
import {
  listHandler,
  createHandler,
  deleteHandler,
  postHandler,
  unpostHandler,
  retryZatcaSubmissionHandler,
  completeZatcaPostingHandler,
} from "./salesDebitNotes.controller";

export const salesDebitNoteRoutes = Router();
salesDebitNoteRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

salesDebitNoteRoutes.get("/", listHandler);
salesDebitNoteRoutes.post("/", canWrite, validateBody(createSalesDebitNoteSchema), createHandler);
salesDebitNoteRoutes.delete("/:id", canWrite, deleteHandler);
salesDebitNoteRoutes.post("/:id/post", canWrite, postHandler);
salesDebitNoteRoutes.post("/:id/unpost", canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
salesDebitNoteRoutes.post("/:id/retry-zatca-submission", canWrite, retryZatcaSubmissionHandler);
salesDebitNoteRoutes.post("/:id/complete-zatca-posting", canWrite, completeZatcaPostingHandler);
