import { Router } from "express";
import { authenticate, enforceCompanyScope } from "../../middleware/auth";
import { expiringDocumentsHandler } from "./hrReports.controller";

export const hrReportRoutes = Router();
hrReportRoutes.use(authenticate, enforceCompanyScope);

hrReportRoutes.get("/expiring-documents", expiringDocumentsHandler);
