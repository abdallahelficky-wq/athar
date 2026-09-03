import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createEmployeeAdvanceSchema, removeSchema } from "./employeeAdvances.schemas";
import { listHandler, createHandler, removeHandler } from "./employeeAdvances.controller";

export const employeeAdvanceRoutes = Router();
employeeAdvanceRoutes.use(authenticate, enforceCompanyScope);

const canWrite = requireRole("admin", "finance_manager", "accountant", "hr_manager");

employeeAdvanceRoutes.get("/", listHandler);
employeeAdvanceRoutes.post("/", canWrite, validateBody(createEmployeeAdvanceSchema), createHandler);
employeeAdvanceRoutes.delete("/:id", canWrite, validateBody(removeSchema), removeHandler);
