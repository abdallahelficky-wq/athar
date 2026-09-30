import { requirePositionAction } from "../../middleware/positionMatrix";
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

employeeRoutes.get("/", requirePositionAction("employees", "read"), listEmployees);
employeeRoutes.get("/:id", requirePositionAction("employees", "read"), requireHrRead, getEmployee);
employeeRoutes.get("/:id/eos", requirePositionAction("employees", "read"), requireHrRead, calculateEos);
employeeRoutes.post("/import", requirePositionAction("employees", "create"), canWrite, validateBody(importEmployeesSchema), importEmployees);
employeeRoutes.post("/", requirePositionAction("employees", "create"), canWrite, validateBody(createEmployeeSchema), createEmployee);
employeeRoutes.patch("/:id", requirePositionAction("employees", "edit"), canWrite, validateBody(updateEmployeeSchema), updateEmployee);
employeeRoutes.get("/:id/portal-access", requirePositionAction("employees", "read"), canWrite, getEmployeePortalAccess);
employeeRoutes.post("/:id/portal-access", requirePositionAction("employees", "edit"), canWrite, validateBody(setPortalAccessSchema), setEmployeePortalAccess);
employeeRoutes.delete("/:id", requirePositionAction("employees", "delete"), canWrite, deleteEmployee);
