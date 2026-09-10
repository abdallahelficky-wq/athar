import { Router } from "express";
import { authenticate, enforceCompanyScope, requireActionPermission, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaveRequestSchema, updateLeaveRequestSchema } from "./leaveRequests.schemas";
import {
  listLeaveRequests, createLeaveRequest, updateLeaveRequestHandler, deleteLeaveRequest, approveLeaveRequestHandler, rejectLeaveRequestHandler,
} from "./leaveRequests.controller";

/**
 * أول وحدة تُهاجَر إلى نظام الصلاحيات الترتيبي الجديد (requireActionPermission) بدلاً من requireRole
 * الثابت — راجع PLATFORM_ACTIONS["leaveRequests"] في lib/platformActions.ts لتوثيق minLevel لكل
 * إجراء (يجب أن يطابق القيمة الممرَّرة هنا يدوياً). الموافقة والرفض يشتركان في نفس الإجراء "approve"
 * عمداً (قرار تحكيم واحد بمستوى واحد، سواء انتهى بقبول أو رفض).
 */
export const leaveRequestRoutes = Router();
leaveRequestRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

leaveRequestRoutes.get("/", requireActionPermission("leaveRequests", "view", "read"), listLeaveRequests);
leaveRequestRoutes.post(
  "/",
  requireActionPermission("leaveRequests", "create", "edit"),
  validateBody(createLeaveRequestSchema),
  createLeaveRequest,
);
leaveRequestRoutes.patch(
  "/:id",
  requireActionPermission("leaveRequests", "edit", "edit"),
  validateBody(updateLeaveRequestSchema),
  updateLeaveRequestHandler,
);
leaveRequestRoutes.post("/:id/approve", requireActionPermission("leaveRequests", "approve", "approve"), approveLeaveRequestHandler);
leaveRequestRoutes.post("/:id/reject", requireActionPermission("leaveRequests", "approve", "approve"), rejectLeaveRequestHandler);
leaveRequestRoutes.delete("/:id", requireActionPermission("leaveRequests", "delete", "full"), deleteLeaveRequest);
