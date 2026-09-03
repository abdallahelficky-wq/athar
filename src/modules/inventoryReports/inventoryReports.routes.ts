import { Router } from "express";
import { authenticate, enforceCompanyScope } from "../../middleware/auth";
import { stockReportHandler } from "./inventoryReports.controller";

export const inventoryReportRoutes = Router();
inventoryReportRoutes.use(authenticate, enforceCompanyScope);

inventoryReportRoutes.get("/stock-report", stockReportHandler);
