import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCompanyBankAccountSchema, updateCompanyBankAccountSchema } from "./companyBankAccounts.schemas";
import {
  listCompanyBankAccounts, createCompanyBankAccount, updateCompanyBankAccount, deleteCompanyBankAccount,
} from "./companyBankAccounts.controller";

export const companyBankAccountRoutes = Router();
companyBankAccountRoutes.use(authenticate, enforceCompanyScope);

const canWrite = requireRole("admin", "finance_manager");

companyBankAccountRoutes.get("/", listCompanyBankAccounts);
companyBankAccountRoutes.post("/", canWrite, validateBody(createCompanyBankAccountSchema), createCompanyBankAccount);
companyBankAccountRoutes.patch("/:id", canWrite, validateBody(updateCompanyBankAccountSchema), updateCompanyBankAccount);
companyBankAccountRoutes.delete("/:id", canWrite, deleteCompanyBankAccount);
