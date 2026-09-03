import { Router } from "express";
import { validateBody } from "../../middleware/validate";
import { authenticate, requireRole } from "../../middleware/auth";
import {
  registerSchema,
  loginSchema,
  completeLoginChoiceSchema,
  refreshSchema,
  inviteSchema,
  setUserActiveSchema,
  acceptInviteSchema,
  changeUnlockPinSchema,
  updateTenantSchema,
  updateMeSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.schemas";
import {
  registerHandler,
  loginHandler,
  completeLoginChoiceHandler,
  refreshHandler,
  logoutHandler,
  inviteHandler,
  listUsersHandler,
  resendInviteHandler,
  setUserActiveHandler,
  deleteUserHandler,
  getInviteInfoHandler,
  acceptInviteHandler,
  changeUnlockPinHandler,
  updateTenantHandler,
  meHandler,
  updateMeHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "./auth.controller";

export const authRoutes = Router();

authRoutes.post("/register", validateBody(registerSchema), registerHandler);
authRoutes.post("/login", validateBody(loginSchema), loginHandler);
authRoutes.post("/login/complete", validateBody(completeLoginChoiceSchema), completeLoginChoiceHandler);
authRoutes.post("/refresh", validateBody(refreshSchema), refreshHandler);
authRoutes.post("/logout", validateBody(refreshSchema), logoutHandler);
authRoutes.post(
  "/invite",
  authenticate,
  requireRole("admin", "finance_manager"),
  validateBody(inviteSchema),
  inviteHandler,
);
authRoutes.get("/users", authenticate, requireRole("admin", "finance_manager"), listUsersHandler);
authRoutes.post(
  "/users/:id/resend-invite",
  authenticate,
  requireRole("admin", "finance_manager"),
  resendInviteHandler,
);
authRoutes.patch(
  "/users/:id/active",
  authenticate,
  requireRole("admin", "finance_manager"),
  validateBody(setUserActiveSchema),
  setUserActiveHandler,
);
// حذف نهائي أخطر من التعطيل (لا رجعة فيه) — يقتصر على admin فقط، بخلاف الدعوة/التعطيل المتاحين
// أيضاً لـfinance_manager، بنفس منطق تقييد حذف الشركة نفسها في companies.routes.ts.
authRoutes.delete("/users/:id", authenticate, requireRole("admin"), deleteUserHandler);
authRoutes.get("/invite-info", getInviteInfoHandler);
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
authRoutes.post("/forgot-password", validateBody(forgotPasswordSchema), forgotPasswordHandler);
authRoutes.post("/reset-password", validateBody(resetPasswordSchema), resetPasswordHandler);
