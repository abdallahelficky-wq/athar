import { Router } from "express";
import { authenticate, requireTenantOwner, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  createPositionSchema,
  updatePositionSchema,
  assignMemberSchema,
  updateActionPermissionSchema,
  upsertUserOverrideSchema,
} from "./positions.schemas";
import * as controller from "./positions.controller";

/**
 * إدارة المناصب وصلاحياتها — مقصورة على مالك الشركة (Tenant.ownerId) وsuper_admin فقط
 * (requireTenantOwner)، وليس أي admin عادي آخر داخل نفس الشركة. المرحلة الأولى: صلاحية واحدة فقط
 * (فك ترحيل القيود) — راجع positions.service.ts.
 */
export const positionRoutes = Router();
positionRoutes.use(authenticate, requireTenantOwner, blockMutationsWhenReadOnly);

positionRoutes.get("/", controller.listHandler);
positionRoutes.get("/assignable-users", controller.listAssignableUsersHandler);
positionRoutes.post("/", validateBody(createPositionSchema), controller.createHandler);
positionRoutes.patch("/:id", validateBody(updatePositionSchema), controller.updateHandler);
positionRoutes.patch("/:id/action-permissions", validateBody(updateActionPermissionSchema), controller.updateActionPermissionHandler);
positionRoutes.delete("/:id", controller.deleteHandler);
positionRoutes.post("/:id/members", validateBody(assignMemberSchema), controller.assignMemberHandler);
positionRoutes.delete("/:id/members/:userId", controller.removeMemberHandler);

positionRoutes.get("/user-overrides", controller.listUserOverridesHandler);
positionRoutes.put("/user-overrides", validateBody(upsertUserOverrideSchema), controller.upsertUserOverrideHandler);
positionRoutes.delete("/user-overrides/:overrideId", controller.deleteUserOverrideHandler);
