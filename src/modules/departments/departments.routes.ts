import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createDepartmentSchema, updateDepartmentSchema } from "./departments.schemas";
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "./departments.controller";

export const departmentRoutes = Router();
departmentRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

departmentRoutes.get("/", requirePositionAction("departments", "read"), listDepartments);
departmentRoutes.post(
  "/", requirePositionAction("departments", "create"),
  requireRole("admin", "finance_manager"),
  validateBody(createDepartmentSchema),
  createDepartment,
);
departmentRoutes.patch(
  "/:id", requirePositionAction("departments", "edit"),
  requireRole("admin", "finance_manager"),
  validateBody(updateDepartmentSchema),
  updateDepartment,
);
departmentRoutes.delete("/:id", requirePositionAction("departments", "delete"), requireRole("admin", "finance_manager"), deleteDepartment);
