import { RequestHandler } from "express";
import * as service from "./purchaseReturns.service";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, supplierId } = req.query;
  const returns = await service.listPurchaseReturns(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    supplierId: typeof supplierId === "string" ? supplierId : undefined,
  });
  res.json(returns);
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createPurchaseReturn(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await service.deletePurchaseReturn(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  res.json(await service.postPurchaseReturn(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  res.json(await service.unpostPurchaseReturn(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};
