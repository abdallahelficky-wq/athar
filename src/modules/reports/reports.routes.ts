import { requirePositionAction } from "../../middleware/positionMatrix";
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
  draftEntriesSummaryHandler,
} from "./reports.controller";

export const reportRoutes = Router();
reportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

reportRoutes.get("/trial-balance", requirePositionAction("reports", "read"), trialBalanceHandler);
reportRoutes.get("/trial-balance-tree", requirePositionAction("reports", "read"), trialBalanceTreeHandler);
reportRoutes.get("/income-statement", requirePositionAction("reports", "read"), incomeStatementHandler);
reportRoutes.get("/balance-sheet", requirePositionAction("reports", "read"), balanceSheetHandler);
reportRoutes.get("/comprehensive-monthly", requirePositionAction("reports", "read"), comprehensiveMonthlyHandler);
reportRoutes.get("/draft-entries-summary", requirePositionAction("reports", "read"), draftEntriesSummaryHandler);
// حدود تنبيه التقرير الشهري الشامل إعداد على مستوى الشركة — بنفس صلاحية تعديل بيانات الشركة نفسها
// (كانت مفتوحة لأي مستخدم مسجَّل، بما فيه "مشاهدة فقط").
reportRoutes.patch("/comprehensive-monthly/settings", requirePositionAction("reports", "edit"), requireRole("admin", "finance_manager"), updateMonthlyReportSettingsHandler);
reportRoutes.get("/customer-statement/:customerId", requirePositionAction("reports", "read"), customerStatementHandler);
reportRoutes.get("/supplier-statement/:supplierId", requirePositionAction("reports", "read"), supplierStatementHandler);
reportRoutes.get("/account-ledger/:accountId", requirePositionAction("reports", "read"), accountLedgerHandler);

reportRoutes.get("/account-ledger/:accountId/pdf", requirePositionAction("reports", "read"), accountLedgerHandler);
