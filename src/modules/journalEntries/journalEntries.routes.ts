import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
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
journalEntryRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل قيد يومية مقفل إجراء استثنائي مقصود تقييده لـ super_admin تحديداً (أضيق من canWrite) —
// خلاف كل شاشات الترحيل الأخرى في النظام؛ القيد اليومي هو السجل الذري الأخير، فتصحيحه المباشر بعد
// الترحيل يحمل وزناً أكبر من فك ترحيل مستند تجاري (فاتورة/سند) يعتمد أصلاً على قيد يومية خلفه.
const superAdminOnly = requireRole("super_admin");

journalEntryRoutes.get("/", listHandler);
// يجب أن يسبق "/:id" كي لا يُعامَل "next-number" كمعرّف قيد
journalEntryRoutes.get("/next-number", nextNumberHandler);
journalEntryRoutes.get("/:id", getHandler);
journalEntryRoutes.get("/:id/pdf", getPdfHandler);
journalEntryRoutes.post("/", canWrite, validateBody(createJournalEntrySchema), createHandler);
journalEntryRoutes.post("/bulk-import/preview", canWrite, validateBody(previewBulkImportSchema), bulkImportPreviewHandler);
journalEntryRoutes.post("/bulk-import/commit", canWrite, validateBody(commitBulkImportSchema), bulkImportCommitHandler);
journalEntryRoutes.post(
  "/from-document",
  canWrite,
  uploadSingleFile,
  validateBody(createFromDocumentSchema),
  createFromDocumentHandler,
);
journalEntryRoutes.patch("/:id", canWrite, validateBody(updateJournalEntrySchema), updateHandler);
journalEntryRoutes.delete("/:id", canWrite, deleteHandler);
journalEntryRoutes.post("/:id/post", canWrite, postHandler);
journalEntryRoutes.post("/:id/unpost", superAdminOnly, validateBody(unpostSchema), unpostHandler);
journalEntryRoutes.post(
  "/:id/mirror-suggestion",
  canWrite,
  validateBody(mirrorSuggestionSchema),
  mirrorSuggestionHandler,
);
journalEntryRoutes.post("/:id/mirror", canWrite, validateBody(createMirrorSchema), createMirrorHandler);
journalEntryRoutes.post("/:id/reverse", canWrite, validateBody(reverseJournalEntrySchema), reverseHandler);
