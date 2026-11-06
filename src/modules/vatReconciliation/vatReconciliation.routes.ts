import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { vatReconciliationHandler, vatReturnHandler } from "./vatReconciliation.controller";

export const vatReconciliationRoutes = Router();
vatReconciliationRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

vatReconciliationRoutes.get("/", requirePositionAction("vatReconciliation", "read"), vatReconciliationHandler);
vatReconciliationRoutes.get("/return", requirePositionAction("vatReconciliation", "read"), vatReturnHandler);
