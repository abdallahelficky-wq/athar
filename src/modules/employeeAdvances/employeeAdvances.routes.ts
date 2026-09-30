import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createEmployeeAdvanceSchema, removeSchema } from "./employeeAdvances.schemas";
import { listHandler, createHandler, removeHandler } from "./employeeAdvances.controller";

export const employeeAdvanceRoutes = Router();
employeeAdvanceRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant", "hr_manager");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

// قراءة السُّلف محصورة بالأدوار التي تُنشئها أصلاً (canWrite: تشمل المحاسب، الذي يربط أقساط السلف
// بسطور القيود في نموذج القيد) — تُغلق القراءة عن "مشاهدة فقط"، دون حرمان المحاسب من مبالغ يراها
// أصلاً في القيود التي يرحّلها بنفسه.
employeeAdvanceRoutes.get("/", requirePositionAction("employeeAdvances", "read"), canWrite, listHandler);
employeeAdvanceRoutes.post("/", requirePositionAction("employeeAdvances", "create"), requirePositionAction("employeeAdvances", "approve"), canWrite, validateBody(createEmployeeAdvanceSchema), createHandler);
employeeAdvanceRoutes.delete("/:id", requirePositionAction("employeeAdvances", "delete"), canWrite, canUnpost, validateBody(removeSchema), removeHandler);
