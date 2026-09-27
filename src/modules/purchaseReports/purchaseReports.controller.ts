import { RequestHandler } from "express";
import * as service from "./purchaseReports.service";
import { parseVatPeriod } from "../../lib/vatPeriod";

const filters = (req: Parameters<RequestHandler>[0]) => ({
  companyId: typeof req.query.companyId === "string" ? req.query.companyId : undefined,
});

export const bySupplierHandler: RequestHandler = async (req, res) => {
  res.json(await service.getPurchasesBySupplier(req.auth!.tenantId, filters(req)));
};

export const monthlyHandler: RequestHandler = async (req, res) => {
  res.json(await service.getPurchasesMonthlyTrend(req.auth!.tenantId, filters(req)));
};

export const vatSummaryHandler: RequestHandler = async (req, res) => {
  res.json(await service.getPurchasesVatSummary(req.auth!.tenantId, await parseVatPeriod(req.auth!.tenantId, req.query)));
};

export const agingHandler: RequestHandler = async (req, res) => {
  res.json(await service.getPayablesAging(req.auth!.tenantId, filters(req)));
};
