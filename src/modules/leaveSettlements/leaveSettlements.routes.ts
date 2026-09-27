import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requireHrRead } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaveSettlementSchema, disburseSchema } from "./leaveSettlements.schemas";
import { listHandler, previewHandler, createHandler, disburseHandler } from "./leaveSettlements.controller";

export const leaveSettlementRoutes = Router();
leaveSettlementRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

leaveSettlementRoutes.get("/", requireHrRead, listHandler);
leaveSettlementRoutes.get("/preview", requireHrRead, previewHandler);
leaveSettlementRoutes.post("/", canWrite, validateBody(createLeaveSettlementSchema), createHandler);
leaveSettlementRoutes.post("/:id/disburse", canWrite, validateBody(disburseSchema), disburseHandler);
