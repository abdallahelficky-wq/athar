import { Router, RequestHandler } from "express";
import { authenticate, requireRole, assertCompanyAccess, blockMutationsWhenReadOnly } from "../../middleware/auth";
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
// :id هنا (من app.ts: /api/companies/:id/zatca) هو معرّف الشركة نفسه — enforceCompanyScope
// العام لا يغطيه لأنه يفحص فقط params.companyId، فيُفحَص هنا صراحة بنفس assertCompanyAccess.
const enforceZatcaCompanyScope: RequestHandler = (req, _res, next) => {
  assertCompanyAccess(req.auth!, req.params.id);
  next();
};
companyZatcaRoutes.use(authenticate, enforceZatcaCompanyScope, blockMutationsWhenReadOnly);

const adminOnly = requireRole("admin");

companyZatcaRoutes.get("/", getStatusHandler);
companyZatcaRoutes.post("/csr", adminOnly, validateBody(generateCsrSchema), generateCsrHandler);
companyZatcaRoutes.post("/compliance", adminOnly, validateBody(complianceOtpSchema), requestComplianceHandler);
companyZatcaRoutes.post("/production", adminOnly, requestProductionHandler);
companyZatcaRoutes.patch("/environment", adminOnly, validateBody(setEnvironmentSchema), setEnvironmentHandler);
companyZatcaRoutes.delete("/", adminOnly, resetLinkageHandler);
