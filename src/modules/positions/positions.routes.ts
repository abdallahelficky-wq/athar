import { Router } from "express";
import { authenticate, requireTenantOwner } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPositionSchema, updatePositionSchema, assignMemberSchema } from "./positions.schemas";
import * as controller from "./positions.controller";

/**
 * إدارة المناصب وصلاحياتها — مقصورة على مالك الشركة (Tenant.ownerId) وsuper_admin فقط
 * (requireTenantOwner)، وليس أي admin عادي آخر داخل نفس الشركة. المرحلة الأولى: صلاحية واحدة فقط
 * (فك ترحيل القيود) — راجع positions.service.ts.
 */
export const positionRoutes = Router();
positionRoutes.use(authenticate, requireTenantOwner);

positionRoutes.get("/", controller.listHandler);
positionRoutes.get("/assignable-users", controller.listAssignableUsersHandler);
positionRoutes.post("/", validateBody(createPositionSchema), controller.createHandler);
positionRoutes.patch("/:id", validateBody(updatePositionSchema), controller.updateHandler);
positionRoutes.delete("/:id", controller.deleteHandler);
positionRoutes.post("/:id/members", validateBody(assignMemberSchema), controller.assignMemberHandler);
positionRoutes.delete("/:id/members/:userId", controller.removeMemberHandler);
