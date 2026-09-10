import { RequestHandler } from "express";
import * as service from "./salesInvoices.service";
import { sendInvoiceByEmail } from "./salesInvoiceEmail.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, customerId } = req.query;
  const invoices = await service.listSalesInvoices(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
  });
  res.json(invoices);
};

export const getHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.getSalesInvoice(req.auth!.tenantId, req.params.id));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createSalesInvoice(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const updateHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.updateSalesInvoice(req.auth!.tenantId, req.params.id, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  await service.deleteSalesInvoice(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.postSalesInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.unpostSalesInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};

export const sendEmailHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  const result = await sendInvoiceByEmail(req.auth!.tenantId, req.params.id, {
    method: "manual",
    overrideEmail: req.body?.email || undefined,
  });
  res.json(result);
};

export const resendZatcaHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.resendInvoiceToZatca(req.auth!.tenantId, req.params.id));
};
