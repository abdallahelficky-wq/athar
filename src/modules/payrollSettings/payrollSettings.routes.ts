import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requireHrRead } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  createComponentSchema, updateComponentSchema, updateSettingsSchema, setEmployeeComponentsSchema,
} from "./payrollSettings.schemas";
import * as controller from "./payrollSettings.controller";

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

// تُركَّب على /api/companies/:companyId/payroll-components و /api/companies/:companyId/payroll-settings
export const companyPayrollSettingsRoutes = Router({ mergeParams: true });
companyPayrollSettingsRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);
companyPayrollSettingsRoutes.get("/payroll-components/adjustable", requirePositionAction("payrollSettings", "read"), requireHrRead, controller.listAdjustableComponentsHandler);
companyPayrollSettingsRoutes.get("/payroll-components", requirePositionAction("payrollSettings", "read"), requireHrRead, controller.listComponentsHandler);
companyPayrollSettingsRoutes.post("/payroll-components", requirePositionAction("payrollSettings", "create"), canWrite, validateBody(createComponentSchema), controller.createComponentHandler);
companyPayrollSettingsRoutes.get("/payroll-settings", requirePositionAction("payrollSettings", "read"), requireHrRead, controller.getSettingsHandler);
companyPayrollSettingsRoutes.patch("/payroll-settings", requirePositionAction("payrollSettings", "edit"), canWrite, validateBody(updateSettingsSchema), controller.updateSettingsHandler);

// تُركَّب على /api/payroll-components/:id
export const payrollComponentRoutes = Router();
payrollComponentRoutes.use(authenticate);
payrollComponentRoutes.patch("/:id", requirePositionAction("payrollSettings", "edit"), canWrite, validateBody(updateComponentSchema), controller.updateComponentHandler);
payrollComponentRoutes.delete("/:id", requirePositionAction("payrollSettings", "delete"), canWrite, controller.deleteComponentHandler);

// تُركَّب على /api/employees/:employeeId/payroll-components
export const employeePayrollComponentRoutes = Router({ mergeParams: true });
employeePayrollComponentRoutes.use(authenticate);
employeePayrollComponentRoutes.get("/", requirePositionAction("payrollSettings", "read"), requireHrRead, controller.getEmployeeComponentsHandler);
employeePayrollComponentRoutes.put("/", requirePositionAction("payrollSettings", "edit"), canWrite, validateBody(setEmployeeComponentsSchema), controller.setEmployeeComponentsHandler);
