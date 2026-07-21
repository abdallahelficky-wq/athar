import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCompanySchema, updateCompanySchema } from "./companies.schemas";
import { listCompanies, createCompany, updateCompany, deleteCompany } from "./companies.controller";

export const companyRoutes = Router();
companyRoutes.use(authenticate);

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
