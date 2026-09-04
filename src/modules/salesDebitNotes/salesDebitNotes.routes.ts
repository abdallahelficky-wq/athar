import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSalesDebitNoteSchema, unpostSchema } from "./salesDebitNotes.schemas";
import { listHandler, createHandler, deleteHandler, postHandler, unpostHandler } from "./salesDebitNotes.controller";

export const salesDebitNoteRoutes = Router();
salesDebitNoteRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

salesDebitNoteRoutes.get("/", listHandler);
salesDebitNoteRoutes.post("/", canWrite, validateBody(createSalesDebitNoteSchema), createHandler);
salesDebitNoteRoutes.delete("/:id", canWrite, deleteHandler);
salesDebitNoteRoutes.post("/:id/post", canWrite, postHandler);
salesDebitNoteRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
