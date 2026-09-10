import { RequestHandler } from "express";
import * as service from "./assetCategories.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  res.json(await service.listAssetCategories(req.auth!.tenantId, { companyId: typeof companyId === "string" ? companyId : undefined }));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createAssetCategory(req.auth!.tenantId, req.body));
};

export const updateHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.assetCategory, req.params.id);
  res.json(await service.updateAssetCategory(req.auth!.tenantId, req.params.id, req.body));
};

export const removeHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.assetCategory, req.params.id);
  await service.removeAssetCategory(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};
