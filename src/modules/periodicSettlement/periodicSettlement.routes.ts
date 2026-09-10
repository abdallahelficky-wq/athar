import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSettlementSchema } from "./periodicSettlement.schemas";
import { listCandidates, createSettlement } from "./periodicSettlement.controller";

export const periodicSettlementRoutes = Router();
periodicSettlementRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

periodicSettlementRoutes.get("/candidates", listCandidates);
periodicSettlementRoutes.post("/", canWrite, validateBody(createSettlementSchema), createSettlement);
