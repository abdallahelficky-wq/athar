import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { stockReportHandler } from "./inventoryReports.controller";

export const inventoryReportRoutes = Router();
inventoryReportRoutes.use(authenticate);

inventoryReportRoutes.get("/stock-report", stockReportHandler);
