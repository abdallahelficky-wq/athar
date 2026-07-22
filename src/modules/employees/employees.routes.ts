import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createEmployeeSchema, updateEmployeeSchema } from "./employees.schemas";
import { listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee, calculateEos } from "./employees.controller";

export const employeeRoutes = Router();
employeeRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

employeeRoutes.get("/", listEmployees);
employeeRoutes.get("/:id", getEmployee);
employeeRoutes.get("/:id/eos", calculateEos);
employeeRoutes.post("/", canWrite, validateBody(createEmployeeSchema), createEmployee);
employeeRoutes.patch("/:id", canWrite, validateBody(updateEmployeeSchema), updateEmployee);
employeeRoutes.delete("/:id", canWrite, deleteEmployee);
