import { RequestHandler } from "express";
import * as service from "./salesReturns.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, customerId } = req.query;
  const returns = await service.listSalesReturns(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
  });
  res.json(returns);
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createSalesReturn(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  await service.deleteSalesReturn(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.postSalesReturn(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.unpostSalesReturn(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};
