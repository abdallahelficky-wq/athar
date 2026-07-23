import { Router } from "express";
import { validateBody } from "../../middleware/validate";
import { authenticate, requireRole } from "../../middleware/auth";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  inviteSchema,
  acceptInviteSchema,
  changeUnlockPinSchema,
  updateTenantSchema,
  updateMeSchema,
} from "./auth.schemas";
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  inviteHandler,
  acceptInviteHandler,
  changeUnlockPinHandler,
  updateTenantHandler,
  meHandler,
  updateMeHandler,
} from "./auth.controller";

export const authRoutes = Router();

authRoutes.post("/register", validateBody(registerSchema), registerHandler);
authRoutes.post("/login", validateBody(loginSchema), loginHandler);
authRoutes.post("/refresh", validateBody(refreshSchema), refreshHandler);
authRoutes.post("/logout", validateBody(refreshSchema), logoutHandler);
authRoutes.post(
  "/invite",
  authenticate,
  requireRole("admin", "finance_manager"),
  validateBody(inviteSchema),
  inviteHandler,
);
authRoutes.post("/accept-invite", validateBody(acceptInviteSchema), acceptInviteHandler);
authRoutes.patch(
  "/unlock-pin",
  authenticate,
  requireRole("admin", "finance_manager"),
  validateBody(changeUnlockPinSchema),
  changeUnlockPinHandler,
);
authRoutes.patch(
  "/tenant",
  authenticate,
  requireRole("admin", "finance_manager"),
  validateBody(updateTenantSchema),
  updateTenantHandler,
);
authRoutes.get("/me", authenticate, meHandler);
authRoutes.patch("/me", authenticate, validateBody(updateMeSchema), updateMeHandler);
