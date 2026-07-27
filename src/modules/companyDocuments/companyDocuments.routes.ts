import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCompanyDocumentSchema, updateCompanyDocumentSchema } from "./companyDocuments.schemas";
import {
  listCompanyDocuments,
  createCompanyDocument,
  updateCompanyDocument,
  deleteCompanyDocument,
} from "./companyDocuments.controller";

export const companyDocumentRoutes = Router();
companyDocumentRoutes.use(authenticate);

companyDocumentRoutes.get("/", listCompanyDocuments);
companyDocumentRoutes.post(
  "/",
  requireRole("admin", "finance_manager"),
  validateBody(createCompanyDocumentSchema),
  createCompanyDocument,
);
companyDocumentRoutes.patch(
  "/:id",
  requireRole("admin", "finance_manager"),
  validateBody(updateCompanyDocumentSchema),
  updateCompanyDocument,
);
companyDocumentRoutes.delete("/:id", requireRole("admin", "finance_manager"), deleteCompanyDocument);
