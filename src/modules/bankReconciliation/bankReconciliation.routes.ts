import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createStatementSchema, matchLineSchema } from "./bankReconciliation.schemas";
import * as c from "./bankReconciliation.controller";

/**
 * التسوية البنكية (bankReconciliation.service.ts). الصلاحيات: read للعرض، create لرفع كشف، edit للمطابقة والتسوية
 * وإعادة الفتح، delete لحذف كشف مفتوح.
 */
export const bankReconciliationRoutes = Router();
bankReconciliationRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

bankReconciliationRoutes.get("/statements", requirePositionAction("bankReconciliation", "read"), c.listHandler);
bankReconciliationRoutes.post("/statements", requirePositionAction("bankReconciliation", "create"), validateBody(createStatementSchema), c.createHandler);
bankReconciliationRoutes.get("/statements/:id", requirePositionAction("bankReconciliation", "read"), c.getHandler);
bankReconciliationRoutes.post("/statements/:id/auto-match", requirePositionAction("bankReconciliation", "edit"), c.autoMatchHandler);
bankReconciliationRoutes.post("/statements/:id/lines/:lineId/match", requirePositionAction("bankReconciliation", "edit"), validateBody(matchLineSchema), c.matchHandler);
bankReconciliationRoutes.post("/statements/:id/lines/:lineId/unmatch", requirePositionAction("bankReconciliation", "edit"), c.unmatchHandler);
bankReconciliationRoutes.post("/statements/:id/reconcile", requirePositionAction("bankReconciliation", "edit"), c.reconcileHandler);
bankReconciliationRoutes.post("/statements/:id/reopen", requirePositionAction("bankReconciliation", "edit"), c.reopenHandler);
bankReconciliationRoutes.delete("/statements/:id", requirePositionAction("bankReconciliation", "delete"), c.deleteHandler);
