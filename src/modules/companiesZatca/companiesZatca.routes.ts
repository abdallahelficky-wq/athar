import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { generateCsrSchema, complianceOtpSchema, setEnvironmentSchema } from "./companiesZatca.schemas";
import {
  getStatusHandler,
  generateCsrHandler,
  requestComplianceHandler,
  requestProductionHandler,
  setEnvironmentHandler,
  resetLinkageHandler,
} from "./companiesZatca.controller";

// كل هذه المسارات إدارية بحتة (ربط CSID) — مقيَّدة لمدير النظام فقط، بخلاف بيانات الشركة العادية
// التي يعدّلها المدير المالي أيضاً؛ التعامل مع مفاتيح/شهادات زاتكا أكثر حساسية.
export const companyZatcaRoutes = Router({ mergeParams: true });
companyZatcaRoutes.use(authenticate);

const adminOnly = requireRole("admin");

companyZatcaRoutes.get("/", getStatusHandler);
companyZatcaRoutes.post("/csr", adminOnly, validateBody(generateCsrSchema), generateCsrHandler);
companyZatcaRoutes.post("/compliance", adminOnly, validateBody(complianceOtpSchema), requestComplianceHandler);
companyZatcaRoutes.post("/production", adminOnly, requestProductionHandler);
companyZatcaRoutes.patch("/environment", adminOnly, validateBody(setEnvironmentSchema), setEnvironmentHandler);
companyZatcaRoutes.delete("/", adminOnly, resetLinkageHandler);
