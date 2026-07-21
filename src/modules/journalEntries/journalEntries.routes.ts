import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  createJournalEntrySchema,
  updateJournalEntrySchema,
  unpostSchema,
  importJournalEntriesSchema,
} from "./journalEntries.schemas";
import {
  listHandler,
  getHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  postHandler,
  unpostHandler,
  importHandler,
} from "./journalEntries.controller";

export const journalEntryRoutes = Router();
journalEntryRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");

journalEntryRoutes.get("/", listHandler);
journalEntryRoutes.get("/:id", getHandler);
journalEntryRoutes.post("/", canWrite, validateBody(createJournalEntrySchema), createHandler);
journalEntryRoutes.post("/import", canWrite, validateBody(importJournalEntriesSchema), importHandler);
journalEntryRoutes.patch("/:id", canWrite, validateBody(updateJournalEntrySchema), updateHandler);
journalEntryRoutes.delete("/:id", canWrite, deleteHandler);
journalEntryRoutes.post("/:id/post", canWrite, postHandler);
journalEntryRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
