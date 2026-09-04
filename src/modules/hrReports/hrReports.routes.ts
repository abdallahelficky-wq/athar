import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { expiringDocumentsHandler } from "./hrReports.controller";

export const hrReportRoutes = Router();
hrReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

hrReportRoutes.get("/expiring-documents", expiringDocumentsHandler);
