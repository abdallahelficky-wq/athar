import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  createComponentSchema, updateComponentSchema, updateSettingsSchema, setEmployeeComponentsSchema,
} from "./payrollSettings.schemas";
import * as controller from "./payrollSettings.controller";

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

// تُركَّب على /api/companies/:companyId/payroll-components و /api/companies/:companyId/payroll-settings
export const companyPayrollSettingsRoutes = Router({ mergeParams: true });
companyPayrollSettingsRoutes.use(authenticate);
companyPayrollSettingsRoutes.get("/payroll-components/adjustable", controller.listAdjustableComponentsHandler);
companyPayrollSettingsRoutes.get("/payroll-components", controller.listComponentsHandler);
companyPayrollSettingsRoutes.post("/payroll-components", canWrite, validateBody(createComponentSchema), controller.createComponentHandler);
companyPayrollSettingsRoutes.get("/payroll-settings", controller.getSettingsHandler);
companyPayrollSettingsRoutes.patch("/payroll-settings", canWrite, validateBody(updateSettingsSchema), controller.updateSettingsHandler);

// تُركَّب على /api/payroll-components/:id
export const payrollComponentRoutes = Router();
payrollComponentRoutes.use(authenticate);
payrollComponentRoutes.patch("/:id", canWrite, validateBody(updateComponentSchema), controller.updateComponentHandler);
payrollComponentRoutes.delete("/:id", canWrite, controller.deleteComponentHandler);

// تُركَّب على /api/employees/:employeeId/payroll-components
export const employeePayrollComponentRoutes = Router({ mergeParams: true });
employeePayrollComponentRoutes.use(authenticate);
employeePayrollComponentRoutes.get("/", controller.getEmployeeComponentsHandler);
employeePayrollComponentRoutes.put("/", canWrite, validateBody(setEmployeeComponentsSchema), controller.setEmployeeComponentsHandler);
