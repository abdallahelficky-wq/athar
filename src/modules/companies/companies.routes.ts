import { Router } from "express";
import { authenticate, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCompanySchema, updateCompanySchema, reopenFiscalClosingSchema, extractDocumentSchema } from "./companies.schemas";
import {
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  reopenFiscalClosing,
  uploadLogoFile,
  uploadLogoHandler,
  extractDocumentHandler,
} from "./companies.controller";
import { uploadSingleFile } from "../attachments/attachments.controller";

export const companyRoutes = Router();
companyRoutes.use(authenticate, blockMutationsWhenReadOnly);

companyRoutes.get("/", listCompanies);
companyRoutes.post(
  "/",
  requireRole("admin", "finance_manager"),
  validateBody(createCompanySchema),
  createCompany,
);
companyRoutes.patch(
  "/:id",
  requireRole("admin", "finance_manager"),
  validateBody(updateCompanySchema),
  updateCompany,
);
companyRoutes.delete("/:id", requireRole("admin"), deleteCompany);
companyRoutes.post(
  "/:id/fiscal-closing/reopen",
  requireRole("admin"),
  validateBody(reopenFiscalClosingSchema),
  reopenFiscalClosing,
);
companyRoutes.post(
  "/:id/logo",
  requireRole("admin", "finance_manager"),
  uploadLogoFile,
  uploadLogoHandler,
);
companyRoutes.post(
  "/:id/extract-document",
  requireRole("admin", "finance_manager"),
  uploadSingleFile,
  validateBody(extractDocumentSchema),
  extractDocumentHandler,
);
