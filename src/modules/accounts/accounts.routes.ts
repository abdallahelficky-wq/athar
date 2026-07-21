import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createAccountSchema, updateAccountSchema } from "./accounts.schemas";
import { listAccounts, createAccount, updateAccount, deleteAccount } from "./accounts.controller";

export const accountRoutes = Router();
accountRoutes.use(authenticate);

accountRoutes.get("/", listAccounts);
accountRoutes.post(
  "/",
  requireRole("admin", "finance_manager"),
  validateBody(createAccountSchema),
  createAccount,
);
accountRoutes.patch(
  "/:id",
  requireRole("admin", "finance_manager"),
  validateBody(updateAccountSchema),
  updateAccount,
);
accountRoutes.delete("/:id", requireRole("admin", "finance_manager"), deleteAccount);
