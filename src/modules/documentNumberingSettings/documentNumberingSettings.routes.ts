import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { updateDocumentNumberingSettingsSchema } from "./documentNumberingSettings.schemas";
import * as controller from "./documentNumberingSettings.controller";

const canWrite = requireRole("admin", "finance_manager");

// تُركَّب على /api/companies/:companyId/document-numbering-settings/:docType
export const companyDocumentNumberingSettingsRoutes = Router({ mergeParams: true });
companyDocumentNumberingSettingsRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);
companyDocumentNumberingSettingsRoutes.get("/document-numbering-settings/:docType", requirePositionAction("documentNumberingSettings", "read"), controller.getSettingsHandler);
companyDocumentNumberingSettingsRoutes.patch(
  "/document-numbering-settings/:docType", requirePositionAction("documentNumberingSettings", "edit"),
  canWrite,
  validateBody(updateDocumentNumberingSettingsSchema),
  controller.updateSettingsHandler,
);
