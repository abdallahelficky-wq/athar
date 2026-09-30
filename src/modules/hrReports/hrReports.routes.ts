import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly, requireHrRead } from "../../middleware/auth";
import { expiringDocumentsHandler } from "./hrReports.controller";

export const hrReportRoutes = Router();
hrReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

hrReportRoutes.get("/expiring-documents", requirePositionAction("hrReports", "read"), requireHrRead, expiringDocumentsHandler);
