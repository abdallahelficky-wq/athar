import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createAccountSchema, updateAccountSchema, importAccountsSchema, installStandardChartSchema } from "./accounts.schemas";
import { listAccounts, nextAccountCode, createAccount, updateAccount, deleteAccount, importAccounts, installStandardChart } from "./accounts.controller";

export const accountRoutes = Router();
accountRoutes.use(authenticate);

accountRoutes.get("/", listAccounts);
accountRoutes.get("/next-code", requireRole("admin", "finance_manager"), nextAccountCode);
accountRoutes.post(
  "/import",
  requireRole("admin", "finance_manager"),
  validateBody(importAccountsSchema),
  importAccounts,
);
accountRoutes.post(
  "/install-standard",
  requireRole("super_admin"),
  validateBody(installStandardChartSchema),
  installStandardChart,
);
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
