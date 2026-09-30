import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createAccountSchema, updateAccountSchema, importAccountsSchema, installStandardChartSchema } from "./accounts.schemas";
import { listAccounts, nextAccountCode, createAccount, updateAccount, deleteAccount, importAccounts, installStandardChart } from "./accounts.controller";

export const accountRoutes = Router();
accountRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

accountRoutes.get("/", requirePositionAction("accounts", "read"), listAccounts);
accountRoutes.get("/next-code", requirePositionAction("accounts", "read"), requireRole("admin", "finance_manager"), nextAccountCode);
accountRoutes.post(
  "/import", requirePositionAction("accounts", "create"),
  requireRole("admin", "finance_manager"),
  validateBody(importAccountsSchema),
  importAccounts,
);
accountRoutes.post(
  "/install-standard", requirePositionAction("accounts", "create"),
  requireRole("super_admin"),
  validateBody(installStandardChartSchema),
  installStandardChart,
);
accountRoutes.post(
  "/", requirePositionAction("accounts", "create"),
  requireRole("admin", "finance_manager"),
  validateBody(createAccountSchema),
  createAccount,
);
accountRoutes.patch(
  "/:id", requirePositionAction("accounts", "edit"),
  requireRole("admin", "finance_manager"),
  validateBody(updateAccountSchema),
  updateAccount,
);
accountRoutes.delete("/:id", requirePositionAction("accounts", "delete"), requireRole("admin", "finance_manager"), deleteAccount);
