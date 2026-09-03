import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPayrollRunSchema, updateEmployeesSchema, setOverrideSchema, unpostSchema } from "./payrollRuns.schemas";
import {
  listHandler,
  createHandler,
  rowsHandler,
  updateEmployeesHandler,
  setOverrideHandler,
  clearOverrideHandler,
  postHandler,
  unpostHandler,
} from "./payrollRuns.controller";

export const payrollRunRoutes = Router();
payrollRunRoutes.use(authenticate, enforceCompanyScope);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

payrollRunRoutes.get("/", listHandler);
payrollRunRoutes.post("/", canWrite, validateBody(createPayrollRunSchema), createHandler);
payrollRunRoutes.get("/:id/rows", rowsHandler);
payrollRunRoutes.patch("/:id/employees", canWrite, validateBody(updateEmployeesSchema), updateEmployeesHandler);
payrollRunRoutes.put("/:id/overrides/:employeeId", canWrite, validateBody(setOverrideSchema), setOverrideHandler);
payrollRunRoutes.delete("/:id/overrides/:employeeId", canWrite, clearOverrideHandler);
payrollRunRoutes.post("/:id/post", canWrite, postHandler);
payrollRunRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
