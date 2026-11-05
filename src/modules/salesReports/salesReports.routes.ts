import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { byCustomerHandler, byItemHandler, byBranchHandler, monthlyHandler, vatSummaryHandler, agingHandler } from "./salesReports.controller";

export const salesReportRoutes = Router();
salesReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

salesReportRoutes.get("/by-customer", requirePositionAction("salesReports", "read"), byCustomerHandler);
salesReportRoutes.get("/by-item", requirePositionAction("salesReports", "read"), byItemHandler);
salesReportRoutes.get("/by-branch", requirePositionAction("salesReports", "read"), byBranchHandler);
salesReportRoutes.get("/monthly", requirePositionAction("salesReports", "read"), monthlyHandler);
salesReportRoutes.get("/vat-summary", requirePositionAction("salesReports", "read"), vatSummaryHandler);
salesReportRoutes.get("/aging", requirePositionAction("salesReports", "read"), agingHandler);
