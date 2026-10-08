import { requirePositionAction, requirePositionPosting } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, requirePermission, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { uploadSingleFile } from "../attachments/attachments.controller";
import {
  createJournalEntrySchema,
  updateJournalEntrySchema,
  unpostSchema,
  createFromDocumentSchema,
  mirrorSuggestionSchema,
  createMirrorSchema,
  reverseJournalEntrySchema,
} from "./journalEntries.schemas";
import { previewBulkImportSchema, commitBulkImportSchema } from "./bulkImport.schemas";
import {
  listHandler,
  exportHandler,
  getHandler,
  getPdfHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  postHandler,
  unpostHandler,
  bulkImportPreviewHandler,
  bulkImportCommitHandler,
  createFromDocumentHandler,
  mirrorSuggestionHandler,
  createMirrorHandler,
  reverseHandler,
  nextNumberHandler,
} from "./journalEntries.controller";

export const journalEntryRoutes = Router();
journalEntryRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل قيد يومية مقفل إجراء استثنائي — القيد اليومي هو السجل الذري الأخير، فتصحيحه المباشر
// بعد الترحيل يحمل وزناً أكبر من فك ترحيل مستند تجاري (فاتورة/سند) يعتمد أصلاً على قيد يومية خلفه.
// المرحلة الأولى من نظام صلاحيات المناصب (Position/PositionPermission): بدل تقييده على super_admin
// وحده، يسمح به الآن أيضاً لمالك الشركة (Tenant.ownerId، دائماً) أو أي مستخدم بمنصب مُفوَّض صراحةً
// بهذه الصلاحية تحديداً (extra.unpost على وحدة "accounts") — راجع requirePermission في
// middleware/auth.ts وشاشة إدارة المناصب في الإعدادات.
const canUnpost = requirePermission("accounts", "unpost");

journalEntryRoutes.get("/", requirePositionAction("journalEntries", "read"), listHandler);
// يجب أن تسبق "/:id" كي لا يُعامَل "next-number"/"export" كمعرّف قيد
journalEntryRoutes.get("/next-number", requirePositionAction("journalEntries", "read"), nextNumberHandler);
journalEntryRoutes.get("/export", requirePositionAction("journalEntries", "read"), exportHandler);
journalEntryRoutes.get("/:id", requirePositionAction("journalEntries", "read"), getHandler);
journalEntryRoutes.get("/:id/pdf", requirePositionAction("journalEntries", "read"), getPdfHandler);
journalEntryRoutes.post("/", requirePositionAction("journalEntries", "create"), requirePositionPosting("journalEntries", false), canWrite, validateBody(createJournalEntrySchema), createHandler);
journalEntryRoutes.post("/bulk-import/preview", requirePositionAction("journalEntries", "read"), canWrite, validateBody(previewBulkImportSchema), bulkImportPreviewHandler);
journalEntryRoutes.post("/bulk-import/commit", requirePositionAction("journalEntries", "create"), requirePositionPosting("journalEntries", false), canWrite, validateBody(commitBulkImportSchema), bulkImportCommitHandler);
journalEntryRoutes.post(
  "/from-document", requirePositionAction("journalEntries", "create"), requirePositionPosting("journalEntries", false),
  canWrite,
  uploadSingleFile,
  validateBody(createFromDocumentSchema),
  createFromDocumentHandler,
);
journalEntryRoutes.patch("/:id", requirePositionAction("journalEntries", "edit"), canWrite, validateBody(updateJournalEntrySchema), updateHandler);
journalEntryRoutes.delete("/:id", requirePositionAction("journalEntries", "delete"), canWrite, deleteHandler);
journalEntryRoutes.post("/:id/post", requirePositionAction("journalEntries", "approve"), canWrite, postHandler);
journalEntryRoutes.post("/:id/unpost", requirePositionAction("journalEntries", "approve"), canUnpost, validateBody(unpostSchema), unpostHandler);
journalEntryRoutes.post(
  "/:id/mirror-suggestion", requirePositionAction("journalEntries", "read"),
  canWrite,
  validateBody(mirrorSuggestionSchema),
  mirrorSuggestionHandler,
);
journalEntryRoutes.post("/:id/mirror", requirePositionAction("journalEntries", "create"), requirePositionAction("journalEntries", "approve"), canWrite, validateBody(createMirrorSchema), createMirrorHandler);
journalEntryRoutes.post("/:id/reverse", requirePositionAction("journalEntries", "approve"), canWrite, validateBody(reverseJournalEntrySchema), reverseHandler);
