import { Router } from "express";
import { authenticate, enforceCompanyScope } from "../../middleware/auth";
import {
  financialKpisHandler,
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
dashboardRoutes.use(authenticate, enforceCompanyScope);

dashboardRoutes.get("/financial-kpis", financialKpisHandler);
dashboardRoutes.get("/cash-breakdown", cashBreakdownHandler);
dashboardRoutes.get("/cash-flow-monthly", cashFlowMonthlyHandler);
dashboardRoutes.get("/top-cash-transactions", topCashTransactionsHandler);
dashboardRoutes.get("/financial-position", financialPositionHandler);
dashboardRoutes.get("/sales-trend", salesTrendHandler);
dashboardRoutes.get("/top-customers", topCustomersHandler);
dashboardRoutes.get("/financial-alerts", financialAlertsHandler);

dashboardRoutes.get("/hr-kpis", hrKpisHandler);
dashboardRoutes.get("/hr-payroll-trend", hrPayrollTrendHandler);
dashboardRoutes.get("/hr-headcount", hrHeadcountHandler);
dashboardRoutes.get("/hr-nationality", hrNationalityHandler);
dashboardRoutes.get("/hr-alerts", hrAlertsHandler);
