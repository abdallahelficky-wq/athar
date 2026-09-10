import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { byCustomerHandler, monthlyHandler, vatSummaryHandler, agingHandler } from "./salesReports.controller";

export const salesReportRoutes = Router();
salesReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

salesReportRoutes.get("/by-customer", byCustomerHandler);
salesReportRoutes.get("/monthly", monthlyHandler);
salesReportRoutes.get("/vat-summary", vatSummaryHandler);
salesReportRoutes.get("/aging", agingHandler);
