import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { vatReconciliationHandler } from "./vatReconciliation.controller";

export const vatReconciliationRoutes = Router();
vatReconciliationRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

vatReconciliationRoutes.get("/", requirePositionAction("vatReconciliation", "read"), vatReconciliationHandler);
