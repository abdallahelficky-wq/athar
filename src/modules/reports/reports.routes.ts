import { Router } from "express";
import { authenticate, enforceCompanyScope } from "../../middleware/auth";
import {
  trialBalanceHandler,
  trialBalanceTreeHandler,
  incomeStatementHandler,
  balanceSheetHandler,
  customerStatementHandler,
  supplierStatementHandler,
  accountLedgerHandler,
  comprehensiveMonthlyHandler,
  updateMonthlyReportSettingsHandler,
} from "./reports.controller";

export const reportRoutes = Router();
reportRoutes.use(authenticate, enforceCompanyScope);

reportRoutes.get("/trial-balance", trialBalanceHandler);
reportRoutes.get("/trial-balance-tree", trialBalanceTreeHandler);
reportRoutes.get("/income-statement", incomeStatementHandler);
reportRoutes.get("/balance-sheet", balanceSheetHandler);
reportRoutes.get("/comprehensive-monthly", comprehensiveMonthlyHandler);
reportRoutes.patch("/comprehensive-monthly/settings", updateMonthlyReportSettingsHandler);
reportRoutes.get("/customer-statement/:customerId", customerStatementHandler);
reportRoutes.get("/supplier-statement/:supplierId", supplierStatementHandler);
reportRoutes.get("/account-ledger/:accountId", accountLedgerHandler);
