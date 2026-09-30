import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { stockReportHandler } from "./inventoryReports.controller";

export const inventoryReportRoutes = Router();
inventoryReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

inventoryReportRoutes.get("/stock-report", requirePositionAction("inventoryReports", "read"), stockReportHandler);
