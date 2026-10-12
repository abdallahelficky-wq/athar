import { requirePositionAction } from "../../middleware/positionMatrix";
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
  reissueZatcaHandler,
  zatcaHistoryHandler,
  zatcaAttemptXmlHandler,
  completeZatcaPostingHandler,
} from "./salesDebitNotes.controller";

export const salesDebitNoteRoutes = Router();
salesDebitNoteRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

salesDebitNoteRoutes.get("/", requirePositionAction("salesDebitNotes", "read"), listHandler);
salesDebitNoteRoutes.post("/", requirePositionAction("salesDebitNotes", "create"), requirePositionAction("salesDebitNotes", "approve"), canWrite, validateBody(createSalesDebitNoteSchema), createHandler);
salesDebitNoteRoutes.delete("/:id", requirePositionAction("salesDebitNotes", "delete"), canWrite, deleteHandler);
salesDebitNoteRoutes.post("/:id/post", requirePositionAction("salesDebitNotes", "approve"), canWrite, postHandler);
salesDebitNoteRoutes.post("/:id/unpost", requirePositionAction("salesDebitNotes", "approve"), canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
salesDebitNoteRoutes.post("/:id/retry-zatca-submission", requirePositionAction("salesDebitNotes", "approve"), canWrite, retryZatcaSubmissionHandler);
salesDebitNoteRoutes.post("/:id/reissue-zatca", requirePositionAction("salesDebitNotes", "approve"), canWrite, reissueZatcaHandler);
salesDebitNoteRoutes.get("/:id/zatca-history", requirePositionAction("salesDebitNotes", "read"), zatcaHistoryHandler);
salesDebitNoteRoutes.get("/:id/zatca-attempts/:attemptId/xml", requirePositionAction("salesDebitNotes", "read"), zatcaAttemptXmlHandler);
salesDebitNoteRoutes.post("/:id/complete-zatca-posting", requirePositionAction("salesDebitNotes", "approve"), canWrite, completeZatcaPostingHandler);
