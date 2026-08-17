import { RequestHandler } from "express";
import * as service from "./employeeAdvances.service";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, employeeId } = req.query;
  res.json(
    await service.listEmployeeAdvances(req.auth!.tenantId, {
      companyId: typeof companyId === "string" ? companyId : undefined,
      employeeId: typeof employeeId === "string" ? employeeId : undefined,
    }),
  );
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createEmployeeAdvance(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const removeHandler: RequestHandler = async (req, res) => {
  await service.removeEmployeeAdvance(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin);
  res.status(204).send();
};
