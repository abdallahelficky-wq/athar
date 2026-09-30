import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requireHrRead } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaveSettlementSchema, disburseSchema } from "./leaveSettlements.schemas";
import { listHandler, previewHandler, createHandler, disburseHandler } from "./leaveSettlements.controller";

export const leaveSettlementRoutes = Router();
leaveSettlementRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

leaveSettlementRoutes.get("/", requirePositionAction("leaveSettlements", "read"), requireHrRead, listHandler);
leaveSettlementRoutes.get("/preview", requirePositionAction("leaveSettlements", "read"), requireHrRead, previewHandler);
leaveSettlementRoutes.post("/", requirePositionAction("leaveSettlements", "create"), canWrite, validateBody(createLeaveSettlementSchema), createHandler);
leaveSettlementRoutes.post("/:id/disburse", requirePositionAction("leaveSettlements", "approve"), canWrite, validateBody(disburseSchema), disburseHandler);
