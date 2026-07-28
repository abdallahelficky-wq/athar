import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import {
  trialBalanceHandler,
  incomeStatementHandler,
  balanceSheetHandler,
  customerStatementHandler,
  supplierStatementHandler,
  accountLedgerHandler,
} from "./reports.controller";

export const reportRoutes = Router();
reportRoutes.use(authenticate);

reportRoutes.get("/trial-balance", trialBalanceHandler);
reportRoutes.get("/income-statement", incomeStatementHandler);
reportRoutes.get("/balance-sheet", balanceSheetHandler);
reportRoutes.get("/customer-statement/:customerId", customerStatementHandler);
reportRoutes.get("/supplier-statement/:supplierId", supplierStatementHandler);
reportRoutes.get("/account-ledger/:accountId", accountLedgerHandler);
