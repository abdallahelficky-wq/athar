import { RequestHandler } from "express";
import { badRequest } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./stationSetup.service";

const companyIdFrom = (value: unknown) => {
  if (typeof value !== "string" || !value) throw badRequest("companyId مطلوب");
  return value;
};

export const listStations: RequestHandler = async (req, res) => {
  const companyId = companyIdFrom(req.query.companyId);
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.listStationsWithPumps(req.auth!.tenantId, companyId));
};

export const createPump: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createPump(req.auth!.tenantId, req.body));
};

export const updateNozzle: RequestHandler = async (req, res) => {
  res.json(await service.updateNozzle(req.auth!.tenantId, (companyId) => assertCompanyAccess(req.auth!, companyId), req.params.id, req.body));
};

export const retirePump: RequestHandler = async (req, res) => {
  res.json(await service.retirePump(req.auth!.tenantId, req.body));
};

export const listFuelPrices: RequestHandler = async (req, res) => {
  const companyId = companyIdFrom(req.query.companyId);
  assertCompanyAccess(req.auth!, companyId);
  res.json(await service.listFuelPrices(req.auth!.tenantId, companyId));
};

export const createFuelPrice: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createFuelPrice(req.auth!.tenantId, req.body));
};

export const deleteFuelPrice: RequestHandler = async (req, res) => {
  await service.deleteUpcomingFuelPrice(req.auth!.tenantId, (companyId) => assertCompanyAccess(req.auth!, companyId), req.params.id);
  res.status(204).end();
};
