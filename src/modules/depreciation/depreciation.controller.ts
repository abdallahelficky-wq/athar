import { RequestHandler } from "express";
import * as service from "./depreciation.service";
import { badRequest } from "../../lib/httpError";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  res.json(await service.listDepreciationRuns(req.auth!.tenantId, { companyId: typeof companyId === "string" ? companyId : undefined }));
};

export const previewHandler: RequestHandler = async (req, res) => {
  const { companyId, month } = req.query;
  if (typeof companyId !== "string" || typeof month !== "string") throw badRequest("companyId و month مطلوبان");
  res.json(await service.previewDepreciation(req.auth!.tenantId, companyId, month));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.postDepreciationRun(req.auth!.tenantId, req.auth!.sub, req.body.companyId, req.body.month));
};

export const removeHandler: RequestHandler = async (req, res) => {
  await service.removeDepreciationRun(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin);
  res.status(204).send();
};
