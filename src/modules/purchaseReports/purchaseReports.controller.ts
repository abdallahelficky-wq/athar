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
  // asOf=YYYY-MM-DD: المركز كما في ذلك اليوم؛ بدونه اليوم
  const asOf = typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? new Date(`${req.query.asOf}T00:00:00.000Z`) : undefined;
  res.json(await service.getPayablesAging(req.auth!.tenantId, { ...filters(req), asOf }));
};
