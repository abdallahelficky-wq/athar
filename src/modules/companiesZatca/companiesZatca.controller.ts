import { RequestHandler } from "express";
import * as service from "./companiesZatca.service";

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
