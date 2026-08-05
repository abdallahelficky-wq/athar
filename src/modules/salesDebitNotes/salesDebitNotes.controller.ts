import { RequestHandler } from "express";
import * as service from "./salesDebitNotes.service";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, customerId } = req.query;
  const debitNotes = await service.listSalesDebitNotes(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
  });
  res.json(debitNotes);
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createSalesDebitNote(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await service.deleteSalesDebitNote(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  res.json(await service.postSalesDebitNote(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  res.json(await service.unpostSalesDebitNote(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};
