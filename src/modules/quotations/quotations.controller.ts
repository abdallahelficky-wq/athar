import { RequestHandler } from "express";
import * as service from "./quotations.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const quotations = await service.listQuotations(req.auth!.tenantId, typeof companyId === "string" ? companyId : undefined);
  res.json(quotations);
};

export const createHandler: RequestHandler = async (req, res) => {
  const quotation = await service.createQuotation(req.auth!.tenantId, req.body);
  res.status(201).json(quotation);
};

export const updateHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.quotation, req.params.id);
  const quotation = await service.updateQuotation(req.auth!.tenantId, req.params.id, req.body);
  res.json(quotation);
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.quotation, req.params.id);
  await service.deleteQuotation(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const convertHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.quotation, req.params.id);
  const invoice = await service.convertQuotationToInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id);
  res.status(201).json(invoice);
};
