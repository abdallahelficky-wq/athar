import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { expiringDocumentsHandler } from "./hrReports.controller";

export const hrReportRoutes = Router();
hrReportRoutes.use(authenticate);

hrReportRoutes.get("/expiring-documents", expiringDocumentsHandler);
