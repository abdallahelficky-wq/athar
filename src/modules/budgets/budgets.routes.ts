import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { budgetSchema, statusSchema } from "./budgets.schemas";
import * as c from "./budgets.controller";

/** الموازنات التقديرية (budgets.service.ts): read للعرض والتقرير والاقتراح، create/edit/delete للموازنة، edit للاعتماد. */
export const budgetRoutes = Router();
budgetRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

budgetRoutes.get("/", requirePositionAction("budgets", "read"), c.listHandler);
budgetRoutes.get("/suggest", requirePositionAction("budgets", "read"), c.suggestHandler);
budgetRoutes.post("/", requirePositionAction("budgets", "create"), validateBody(budgetSchema), c.createHandler);
budgetRoutes.get("/:id", requirePositionAction("budgets", "read"), c.getHandler);
budgetRoutes.get("/:id/report", requirePositionAction("budgets", "read"), c.reportHandler);
budgetRoutes.put("/:id", requirePositionAction("budgets", "edit"), validateBody(budgetSchema), c.updateHandler);
budgetRoutes.post("/:id/status", requirePositionAction("budgets", "edit"), validateBody(statusSchema), c.statusHandler);
budgetRoutes.delete("/:id", requirePositionAction("budgets", "delete"), c.deleteHandler);
