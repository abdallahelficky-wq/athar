import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission, requireHrRead } from "../../middleware/auth";
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
payrollRunRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

payrollRunRoutes.get("/", requireHrRead, listHandler);
payrollRunRoutes.post("/", canWrite, validateBody(createPayrollRunSchema), createHandler);
payrollRunRoutes.get("/:id/rows", requireHrRead, rowsHandler);
payrollRunRoutes.patch("/:id/employees", canWrite, validateBody(updateEmployeesSchema), updateEmployeesHandler);
payrollRunRoutes.put("/:id/overrides/:employeeId", canWrite, validateBody(setOverrideSchema), setOverrideHandler);
payrollRunRoutes.delete("/:id/overrides/:employeeId", canWrite, clearOverrideHandler);
payrollRunRoutes.post("/:id/post", canWrite, postHandler);
payrollRunRoutes.post("/:id/unpost", canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
