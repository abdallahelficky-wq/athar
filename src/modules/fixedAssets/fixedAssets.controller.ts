import { RequestHandler } from "express";
import * as service from "./fixedAssets.service";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  res.json(await service.listFixedAssets(req.auth!.tenantId, { companyId: typeof companyId === "string" ? companyId : undefined }));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createFixedAsset(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const updateHandler: RequestHandler = async (req, res) => {
  res.json(await service.updateFixedAsset(req.auth!.tenantId, req.params.id, req.body));
};

export const removeHandler: RequestHandler = async (req, res) => {
  await service.removeFixedAsset(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin);
  res.status(204).send();
};

export const disposeHandler: RequestHandler = async (req, res) => {
  res.json(await service.disposeFixedAsset(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body));
};

export const summaryHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  res.json(await service.getFixedAssetsSummary(req.auth!.tenantId, { companyId: typeof companyId === "string" ? companyId : undefined }));
};
