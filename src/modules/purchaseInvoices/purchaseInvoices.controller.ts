import { RequestHandler } from "express";
import * as service from "./purchaseInvoices.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, supplierId } = req.query;
  const invoices = await service.listPurchaseInvoices(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    supplierId: typeof supplierId === "string" ? supplierId : undefined,
  });
  res.json(invoices);
};

export const getHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.purchaseInvoice, req.params.id);
  res.json(await service.getPurchaseInvoice(req.auth!.tenantId, req.params.id));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createPurchaseInvoice(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const updateHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.purchaseInvoice, req.params.id);
  res.json(await service.updatePurchaseInvoice(req.auth!.tenantId, req.params.id, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.purchaseInvoice, req.params.id);
  await service.deletePurchaseInvoice(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.purchaseInvoice, req.params.id);
  res.json(await service.postPurchaseInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.purchaseInvoice, req.params.id);
  res.json(await service.unpostPurchaseInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};
