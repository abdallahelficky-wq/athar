import { RequestHandler } from "express";
import * as service from "./payrollSettings.service";

export const listComponentsHandler: RequestHandler = async (req, res) => {
  res.json(await service.listPayrollComponents(req.auth!.tenantId, req.params.companyId));
};

export const listAdjustableComponentsHandler: RequestHandler = async (req, res) => {
  res.json(await service.listAdjustableComponents(req.auth!.tenantId, req.params.companyId));
};

export const createComponentHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createPayrollComponent(req.auth!.tenantId, req.params.companyId, req.body));
};

export const updateComponentHandler: RequestHandler = async (req, res) => {
  res.json(await service.updatePayrollComponent(req.auth!.tenantId, req.params.id, req.body));
};

export const deleteComponentHandler: RequestHandler = async (req, res) => {
  await service.deletePayrollComponent(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const getSettingsHandler: RequestHandler = async (req, res) => {
  res.json(await service.getPayrollSettings(req.auth!.tenantId, req.params.companyId));
};

export const updateSettingsHandler: RequestHandler = async (req, res) => {
  res.json(await service.updatePayrollSettings(req.auth!.tenantId, req.params.companyId, req.body));
};

export const getEmployeeComponentsHandler: RequestHandler = async (req, res) => {
  res.json(await service.getEmployeePayrollComponents(req.auth!.tenantId, req.params.employeeId));
};

export const setEmployeeComponentsHandler: RequestHandler = async (req, res) => {
  res.json(await service.setEmployeePayrollComponents(req.auth!.tenantId, req.params.employeeId, req.body));
};
