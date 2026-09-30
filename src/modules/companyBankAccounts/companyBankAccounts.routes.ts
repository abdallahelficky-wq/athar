import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCompanyBankAccountSchema, updateCompanyBankAccountSchema } from "./companyBankAccounts.schemas";
import {
  listCompanyBankAccounts, createCompanyBankAccount, updateCompanyBankAccount, deleteCompanyBankAccount,
} from "./companyBankAccounts.controller";

export const companyBankAccountRoutes = Router();
companyBankAccountRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager");

companyBankAccountRoutes.get("/", requirePositionAction("companyBankAccounts", "read"), listCompanyBankAccounts);
companyBankAccountRoutes.post("/", requirePositionAction("companyBankAccounts", "create"), canWrite, validateBody(createCompanyBankAccountSchema), createCompanyBankAccount);
companyBankAccountRoutes.patch("/:id", requirePositionAction("companyBankAccounts", "edit"), canWrite, validateBody(updateCompanyBankAccountSchema), updateCompanyBankAccount);
companyBankAccountRoutes.delete("/:id", requirePositionAction("companyBankAccounts", "delete"), canWrite, deleteCompanyBankAccount);
