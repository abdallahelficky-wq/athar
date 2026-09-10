import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { bySupplierHandler, monthlyHandler, vatSummaryHandler, agingHandler } from "./purchaseReports.controller";

export const purchaseReportRoutes = Router();
purchaseReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

purchaseReportRoutes.get("/by-supplier", bySupplierHandler);
purchaseReportRoutes.get("/monthly", monthlyHandler);
purchaseReportRoutes.get("/vat-summary", vatSummaryHandler);
purchaseReportRoutes.get("/aging", agingHandler);
