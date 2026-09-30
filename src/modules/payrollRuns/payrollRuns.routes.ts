import { requirePositionAction } from "../../middleware/positionMatrix";
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

payrollRunRoutes.get("/", requirePositionAction("payrollRuns", "read"), requireHrRead, listHandler);
payrollRunRoutes.post("/", requirePositionAction("payrollRuns", "create"), canWrite, validateBody(createPayrollRunSchema), createHandler);
payrollRunRoutes.get("/:id/rows", requirePositionAction("payrollRuns", "read"), requireHrRead, rowsHandler);
payrollRunRoutes.patch("/:id/employees", requirePositionAction("payrollRuns", "edit"), canWrite, validateBody(updateEmployeesSchema), updateEmployeesHandler);
payrollRunRoutes.put("/:id/overrides/:employeeId", requirePositionAction("payrollRuns", "edit"), canWrite, validateBody(setOverrideSchema), setOverrideHandler);
payrollRunRoutes.delete("/:id/overrides/:employeeId", requirePositionAction("payrollRuns", "delete"), canWrite, clearOverrideHandler);
payrollRunRoutes.post("/:id/post", requirePositionAction("payrollRuns", "approve"), canWrite, postHandler);
payrollRunRoutes.post("/:id/unpost", requirePositionAction("payrollRuns", "approve"), canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
