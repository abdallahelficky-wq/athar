import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCostCenterSchema, updateCostCenterSchema } from "./costCenters.schemas";
import {
  listCostCenters,
  createCostCenter,
  updateCostCenter,
  deleteCostCenter,
} from "./costCenters.controller";

export const costCenterRoutes = Router();
costCenterRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

costCenterRoutes.get("/", requirePositionAction("costCenters", "read"), listCostCenters);
costCenterRoutes.post(
  "/", requirePositionAction("costCenters", "create"),
  requireRole("admin", "finance_manager"),
  validateBody(createCostCenterSchema),
  createCostCenter,
);
costCenterRoutes.patch(
  "/:id", requirePositionAction("costCenters", "edit"),
  requireRole("admin", "finance_manager"),
  validateBody(updateCostCenterSchema),
  updateCostCenter,
);
costCenterRoutes.delete("/:id", requirePositionAction("costCenters", "delete"), requireRole("admin", "finance_manager"), deleteCostCenter);
