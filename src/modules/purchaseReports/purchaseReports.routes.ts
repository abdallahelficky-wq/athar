import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { bySupplierHandler, monthlyHandler, vatSummaryHandler, agingHandler } from "./purchaseReports.controller";

export const purchaseReportRoutes = Router();
purchaseReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

purchaseReportRoutes.get("/by-supplier", requirePositionAction("purchaseReports", "read"), bySupplierHandler);
purchaseReportRoutes.get("/monthly", requirePositionAction("purchaseReports", "read"), monthlyHandler);
purchaseReportRoutes.get("/vat-summary", requirePositionAction("purchaseReports", "read"), vatSummaryHandler);
purchaseReportRoutes.get("/aging", requirePositionAction("purchaseReports", "read"), agingHandler);
