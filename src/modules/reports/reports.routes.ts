import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly, requireRole } from "../../middleware/auth";
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
reportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

reportRoutes.get("/trial-balance", trialBalanceHandler);
reportRoutes.get("/trial-balance-tree", trialBalanceTreeHandler);
reportRoutes.get("/income-statement", incomeStatementHandler);
reportRoutes.get("/balance-sheet", balanceSheetHandler);
reportRoutes.get("/comprehensive-monthly", comprehensiveMonthlyHandler);
// حدود تنبيه التقرير الشهري الشامل إعداد على مستوى الشركة — بنفس صلاحية تعديل بيانات الشركة نفسها
// (كانت مفتوحة لأي مستخدم مسجَّل، بما فيه "مشاهدة فقط").
reportRoutes.patch("/comprehensive-monthly/settings", requireRole("admin", "finance_manager"), updateMonthlyReportSettingsHandler);
reportRoutes.get("/customer-statement/:customerId", customerStatementHandler);
reportRoutes.get("/supplier-statement/:supplierId", supplierStatementHandler);
reportRoutes.get("/account-ledger/:accountId", accountLedgerHandler);
