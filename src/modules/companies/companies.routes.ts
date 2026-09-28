import { Router } from "express";
import { authenticate, requireRole, requireTenantOwner, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCompanySchema, createIndependentCompanySchema, updateCompanySchema, reopenFiscalClosingSchema, extractDocumentSchema, balancesPostedOnlySchema, payrollTotalsFromMonthSchema } from "./companies.schemas";
import {
  listCompanies,
  createCompany,
  createIndependentCompany,
  updateCompany,
  deleteCompany,
  reopenFiscalClosing,
  uploadLogoFile,
  uploadLogoHandler,
  extractDocumentHandler,
  setBalancesPostedOnly,
  setPayrollTotalsFromMonth,
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
// «شركة مستقلة» — مستأجر جديد لنفس هوية المستخدم، بنفس صلاحية إضافة شركة ضمن المجموعة أعلاه
companyRoutes.post(
  "/independent",
  requireRole("admin", "finance_manager"),
  validateBody(createIndependentCompanySchema),
  createIndependentCompany,
);
companyRoutes.patch(
  "/:id",
  requireRole("admin", "finance_manager"),
  validateBody(updateCompanySchema),
  updateCompany,
);
// حذف الشركة أُزيل من التطبيق — يُعيد 405 دائماً لأي مستخدم (راجع deleteCompany)
companyRoutes.delete("/:id", deleteCompany);
// مفتاح "الأرصدة تحتسب المرحَّل فقط" — يغيّر كل رقم معروض للشركة، فهو للمالك وحده
companyRoutes.patch("/:id/balances-posted-only", requireTenantOwner, validateBody(balancesPostedOnlySchema), setBalancesPostedOnly);
// أول شهر يُرحَّل فيه كشف الرواتب إجماليات — يغيّر أين يقع صافي الرواتب في الدفاتر، فهو للمالك وحده
companyRoutes.patch("/:id/payroll-totals-from-month", requireTenantOwner, validateBody(payrollTotalsFromMonthSchema), setPayrollTotalsFromMonth);
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
