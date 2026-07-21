import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCostCenterSchema, updateCostCenterSchema } from "./costCenters.schemas";
import {
  listCostCenters,
  createCostCenter,
  updateCostCenter,
  deleteCostCenter,
} from "./costCenters.controller";

export const costCenterRoutes = Router();
costCenterRoutes.use(authenticate);

costCenterRoutes.get("/", listCostCenters);
costCenterRoutes.post(
  "/",
  requireRole("admin", "finance_manager"),
  validateBody(createCostCenterSchema),
  createCostCenter,
);
costCenterRoutes.patch(
  "/:id",
  requireRole("admin", "finance_manager"),
  validateBody(updateCostCenterSchema),
  updateCostCenter,
);
costCenterRoutes.delete("/:id", requireRole("admin", "finance_manager"), deleteCostCenter);
