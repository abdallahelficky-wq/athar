import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import {
  financialKpisHandler,
  incomeExpenseTrendHandler,
  cashBreakdownHandler,
  cashFlowMonthlyHandler,
  topCashTransactionsHandler,
  financialPositionHandler,
  salesTrendHandler,
  topCustomersHandler,
  financialAlertsHandler,
  hrKpisHandler,
  hrPayrollTrendHandler,
  hrHeadcountHandler,
  hrNationalityHandler,
  hrAlertsHandler,
} from "./dashboard.controller";

export const dashboardRoutes = Router();
dashboardRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

dashboardRoutes.get("/financial-kpis", requirePositionAction("dashboard", "read"), financialKpisHandler);
dashboardRoutes.get("/income-expense-trend", requirePositionAction("dashboard", "read"), incomeExpenseTrendHandler);
dashboardRoutes.get("/cash-breakdown", requirePositionAction("dashboard", "read"), cashBreakdownHandler);
dashboardRoutes.get("/cash-flow-monthly", requirePositionAction("dashboard", "read"), cashFlowMonthlyHandler);
dashboardRoutes.get("/top-cash-transactions", requirePositionAction("dashboard", "read"), topCashTransactionsHandler);
dashboardRoutes.get("/financial-position", requirePositionAction("dashboard", "read"), financialPositionHandler);
dashboardRoutes.get("/sales-trend", requirePositionAction("dashboard", "read"), salesTrendHandler);
dashboardRoutes.get("/top-customers", requirePositionAction("dashboard", "read"), topCustomersHandler);
dashboardRoutes.get("/financial-alerts", requirePositionAction("dashboard", "read"), financialAlertsHandler);

dashboardRoutes.get("/hr-kpis", requirePositionAction("dashboard", "read"), hrKpisHandler);
dashboardRoutes.get("/hr-payroll-trend", requirePositionAction("dashboard", "read"), hrPayrollTrendHandler);
dashboardRoutes.get("/hr-headcount", requirePositionAction("dashboard", "read"), hrHeadcountHandler);
dashboardRoutes.get("/hr-nationality", requirePositionAction("dashboard", "read"), hrNationalityHandler);
dashboardRoutes.get("/hr-alerts", requirePositionAction("dashboard", "read"), hrAlertsHandler);
