import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createEmployeeSchema, updateEmployeeSchema, importEmployeesSchema, setPortalAccessSchema } from "./employees.schemas";
import {
  listEmployees, getEmployee, createEmployee, importEmployees, updateEmployee, deleteEmployee, calculateEos, setEmployeePortalAccess,
} from "./employees.controller";

export const employeeRoutes = Router();
employeeRoutes.use(authenticate, enforceCompanyScope);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

employeeRoutes.get("/", listEmployees);
employeeRoutes.get("/:id", getEmployee);
employeeRoutes.get("/:id/eos", calculateEos);
employeeRoutes.post("/import", canWrite, validateBody(importEmployeesSchema), importEmployees);
employeeRoutes.post("/", canWrite, validateBody(createEmployeeSchema), createEmployee);
employeeRoutes.patch("/:id", canWrite, validateBody(updateEmployeeSchema), updateEmployee);
employeeRoutes.post("/:id/portal-access", canWrite, validateBody(setPortalAccessSchema), setEmployeePortalAccess);
employeeRoutes.delete("/:id", canWrite, deleteEmployee);
