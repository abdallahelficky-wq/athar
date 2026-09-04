import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createHrActionBatchSchema } from "./hrActions.schemas";
import { listHrActions, createHrActionBatch, deleteHrAction } from "./hrActions.controller";

export const hrActionRoutes = Router();
hrActionRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

hrActionRoutes.get("/", listHrActions);
hrActionRoutes.post("/", canWrite, validateBody(createHrActionBatchSchema), createHrActionBatch);
hrActionRoutes.delete("/:id", canWrite, deleteHrAction);
