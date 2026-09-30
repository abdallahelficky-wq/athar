import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { byCustomerHandler, monthlyHandler, vatSummaryHandler, agingHandler } from "./salesReports.controller";

export const salesReportRoutes = Router();
salesReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

salesReportRoutes.get("/by-customer", requirePositionAction("salesReports", "read"), byCustomerHandler);
salesReportRoutes.get("/monthly", requirePositionAction("salesReports", "read"), monthlyHandler);
salesReportRoutes.get("/vat-summary", requirePositionAction("salesReports", "read"), vatSummaryHandler);
salesReportRoutes.get("/aging", requirePositionAction("salesReports", "read"), agingHandler);
