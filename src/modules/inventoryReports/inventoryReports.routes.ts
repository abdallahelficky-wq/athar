import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { stockReportHandler, movementSummaryHandler } from "./inventoryReports.controller";

export const inventoryReportRoutes = Router();
inventoryReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

inventoryReportRoutes.get("/stock-report", requirePositionAction("inventoryReports", "read"), stockReportHandler);
inventoryReportRoutes.get("/movement-summary", requirePositionAction("inventoryReports", "read"), movementSummaryHandler);
