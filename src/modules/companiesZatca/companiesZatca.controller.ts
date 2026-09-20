import { RequestHandler } from "express";
import * as service from "./companiesZatca.service";
import { runZatcaComplianceStep, getZatcaComplianceProgress } from "../../lib/zatca/complianceAutomation";

export const getStatusHandler: RequestHandler = async (req, res) => {
  res.json(await service.getZatcaStatus(req.auth!.tenantId, req.params.id));
};

export const generateCsrHandler: RequestHandler = async (req, res) => {
  res.json(await service.generateCompanyCsr(req.auth!.tenantId, req.params.id, req.body));
};

export const requestComplianceHandler: RequestHandler = async (req, res) => {
  res.json(await service.requestCompanyComplianceCsid(req.auth!.tenantId, req.params.id, req.body.otp));
};

export const requestProductionHandler: RequestHandler = async (req, res) => {
  res.json(await service.requestCompanyProductionCsid(req.auth!.tenantId, req.params.id));
};

export const setEnvironmentHandler: RequestHandler = async (req, res) => {
  res.json(await service.setCompanyZatcaEnvironment(req.auth!.tenantId, req.params.id, req.body.environment));
};

export const resetLinkageHandler: RequestHandler = async (req, res) => {
  res.json(await service.resetCompanyZatcaLinkage(req.auth!.tenantId, req.params.id));
};

// راجع src/lib/zatca/complianceAutomation.ts — مستند اصطناعي بالكامل (عميل ومرجع فاتورة مُلفَّقان)،
// لا يمسّ أي SalesInvoice/SalesReturn/SalesDebitNote/JournalEntry حقيقي. stepKey يُتحقَّق منه داخل
// runZatcaComplianceStep نفسها (اسم غير معروف أو enabled=false يُرفَض هناك قبل أي اتصال بزاتكا) —
// لا تكرار لذلك التحقق هنا.
export const runComplianceStepTestHandler: RequestHandler = async (req, res) => {
  res.json(await runZatcaComplianceStep(req.auth!.tenantId, req.params.id, req.params.stepKey));
};

export const getComplianceProgressHandler: RequestHandler = async (req, res) => {
  res.json(await getZatcaComplianceProgress(req.auth!.tenantId, req.params.id));
};
