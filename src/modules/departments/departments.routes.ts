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

departmentRoutes.get("/", listDepartments);
departmentRoutes.post(
  "/",
  requireRole("admin", "finance_manager"),
  validateBody(createDepartmentSchema),
  createDepartment,
);
departmentRoutes.patch(
  "/:id",
  requireRole("admin", "finance_manager"),
  validateBody(updateDepartmentSchema),
  updateDepartment,
);
departmentRoutes.delete("/:id", requireRole("admin", "finance_manager"), deleteDepartment);
