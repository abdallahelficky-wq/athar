import { RequestHandler } from "express";
import * as service from "./salesReports.service";

const filters = (req: Parameters<RequestHandler>[0]) => ({
  companyId: typeof req.query.companyId === "string" ? req.query.companyId : undefined,
});

export const byCustomerHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesByCustomer(req.auth!.tenantId, filters(req)));
};

export const monthlyHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesMonthlyTrend(req.auth!.tenantId, filters(req)));
};

export const vatSummaryHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesVatSummary(req.auth!.tenantId, filters(req)));
};

export const agingHandler: RequestHandler = async (req, res) => {
  res.json(await service.getReceivablesAging(req.auth!.tenantId, filters(req)));
};
