import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requireHrRead } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createHrActionBatchSchema } from "./hrActions.schemas";
import { listHrActions, createHrActionBatch, deleteHrAction } from "./hrActions.controller";

export const hrActionRoutes = Router();
hrActionRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

hrActionRoutes.get("/", requirePositionAction("hrActions", "read"), requireHrRead, listHrActions);
hrActionRoutes.post("/", requirePositionAction("hrActions", "create"), canWrite, validateBody(createHrActionBatchSchema), createHrActionBatch);
hrActionRoutes.delete("/:id", requirePositionAction("hrActions", "delete"), canWrite, deleteHrAction);
