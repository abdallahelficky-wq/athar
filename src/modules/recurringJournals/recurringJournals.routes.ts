import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { activeSchema, templateSchema } from "./recurringJournals.schemas";
import * as c from "./recurringJournals.controller";

/**
 * القيود الدورية (recurringJournals.service.ts) — بصلاحيات القيود اليومية نفسها: القالب يُنشئ قيوداً، فمن لا يملك
 * إنشاء قيد لا ينشئ قالباً ولا يشغّله.
 */
export const recurringJournalRoutes = Router();
recurringJournalRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

recurringJournalRoutes.get("/", requirePositionAction("journalEntries", "read"), c.listHandler);
recurringJournalRoutes.get("/:id", requirePositionAction("journalEntries", "read"), c.getHandler);
recurringJournalRoutes.post("/", requirePositionAction("journalEntries", "create"), validateBody(templateSchema), c.createHandler);
recurringJournalRoutes.put("/:id", requirePositionAction("journalEntries", "edit"), validateBody(templateSchema), c.updateHandler);
recurringJournalRoutes.post("/:id/active", requirePositionAction("journalEntries", "edit"), validateBody(activeSchema), c.activeHandler);
recurringJournalRoutes.post("/:id/run-now", requirePositionAction("journalEntries", "create"), c.runNowHandler);
recurringJournalRoutes.delete("/:id", requirePositionAction("journalEntries", "delete"), c.deleteHandler);
