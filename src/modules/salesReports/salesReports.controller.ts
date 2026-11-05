import { RequestHandler } from "express";
import * as service from "./salesReports.service";
import { parseVatPeriod } from "../../lib/vatPeriod";
import { parseReportFilters } from "../../lib/reportFilters";

const filters = (req: Parameters<RequestHandler>[0]) => parseReportFilters(req.query);

export const byItemHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesByItem(req.auth!.tenantId, filters(req)));
};

export const byBranchHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesByBranch(req.auth!.tenantId, filters(req)));
};

export const byCustomerHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesByCustomer(req.auth!.tenantId, filters(req)));
};

export const monthlyHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesMonthlyTrend(req.auth!.tenantId, filters(req)));
};

export const vatSummaryHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesVatSummary(req.auth!.tenantId, await parseVatPeriod(req.auth!.tenantId, req.query)));
};

export const agingHandler: RequestHandler = async (req, res) => {
  // asOf=YYYY-MM-DD: المركز كما في ذلك اليوم؛ بدونه اليوم
  const asOf = typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? new Date(`${req.query.asOf}T00:00:00.000Z`) : undefined;
  res.json(await service.getReceivablesAging(req.auth!.tenantId, { ...filters(req), asOf }));
};
