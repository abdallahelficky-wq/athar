import { RequestHandler } from "express";
import * as service from "./employeePortal.service";

export const login: RequestHandler = async (req, res) => {
  const { tenantId, phone, pin } = req.body;
  res.json(await service.employeePortalLogin(tenantId, phone, pin, req.ip ?? "unknown"));
};

export const me: RequestHandler = async (req, res) => {
  res.json(await service.employeePortalProfile(req.employeeAuth!.employeeId, req.employeeAuth!.tenantId));
};
