import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requireHrRead } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createEmployeeSchema, updateEmployeeSchema, importEmployeesSchema, setPortalAccessSchema } from "./employees.schemas";
import {
  listEmployees, getEmployee, createEmployee, importEmployees, updateEmployee, deleteEmployee, calculateEos, setEmployeePortalAccess, getEmployeePortalAccess,
} from "./employees.controller";

export const employeeRoutes = Router();
employeeRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

employeeRoutes.get("/", listEmployees);
employeeRoutes.get("/:id", requireHrRead, getEmployee);
employeeRoutes.get("/:id/eos", requireHrRead, calculateEos);
employeeRoutes.post("/import", canWrite, validateBody(importEmployeesSchema), importEmployees);
employeeRoutes.post("/", canWrite, validateBody(createEmployeeSchema), createEmployee);
employeeRoutes.patch("/:id", canWrite, validateBody(updateEmployeeSchema), updateEmployee);
employeeRoutes.get("/:id/portal-access", canWrite, getEmployeePortalAccess);
employeeRoutes.post("/:id/portal-access", canWrite, validateBody(setPortalAccessSchema), setEmployeePortalAccess);
employeeRoutes.delete("/:id", canWrite, deleteEmployee);
