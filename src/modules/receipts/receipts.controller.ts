import { RequestHandler } from "express";
import * as service from "./receipts.service";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, customerId } = req.query;
  const receipts = await service.listReceipts(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
  });
  res.json(receipts);
};

export const outstandingInvoicesHandler: RequestHandler = async (req, res) => {
  const invoices = await service.getOutstandingInvoices(req.auth!.tenantId, req.params.customerId);
  res.json(invoices);
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createReceipt(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await service.deleteReceipt(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  res.json(await service.postReceipt(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  res.json(await service.unpostReceipt(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};

export const addAllocationHandler: RequestHandler = async (req, res) => {
  const result = await service.addReceiptAllocation(req.auth!.tenantId, req.params.id, req.body.invoiceId, Number(req.body.amount));
  res.status(201).json(result);
};

export const removeAllocationHandler: RequestHandler = async (req, res) => {
  const result = await service.removeReceiptAllocation(req.auth!.tenantId, req.params.id, req.params.invoiceId);
  res.json(result);
};
