import { RequestHandler } from "express";
import * as service from "./leaveSettlements.service";
import { badRequest } from "../../lib/httpError";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, employeeId } = req.query;
  res.json(await service.listLeaveSettlements(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    employeeId: typeof employeeId === "string" ? employeeId : undefined,
  }));
};

export const previewHandler: RequestHandler = async (req, res) => {
  const { employeeId, leaveStartDate } = req.query;
  if (typeof employeeId !== "string" || typeof leaveStartDate !== "string") throw badRequest("employeeId و leaveStartDate مطلوبان");
  res.json(await service.previewLeaveSettlement(req.auth!.tenantId, employeeId, new Date(leaveStartDate)));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createLeaveSettlement(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const disburseHandler: RequestHandler = async (req, res) => {
  res.json(await service.disburseLeaveSettlement(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.method, req.body.date));
};
