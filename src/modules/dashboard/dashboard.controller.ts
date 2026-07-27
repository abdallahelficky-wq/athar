import { Request, RequestHandler } from "express";
import * as service from "./dashboard.service";

function parseCompanyId(req: Request) {
  const { companyId } = req.query;
  return typeof companyId === "string" && companyId ? companyId : undefined;
}

function parseRange(req: Request) {
  const { dateFrom, dateTo } = req.query;
  const dateTo_ = typeof dateTo === "string" ? new Date(dateTo) : new Date();
  const dateFrom_ =
    typeof dateFrom === "string"
      ? new Date(dateFrom)
      : new Date(dateTo_.getFullYear(), dateTo_.getMonth(), 1);
  return { dateFrom: dateFrom_, dateTo: dateTo_ };
}

function parseWithinDays(req: Request, fallback = 60) {
  const { withinDays } = req.query;
  return typeof withinDays === "string" ? Number(withinDays) : fallback;
}

function parseMonths(req: Request, fallback = 12) {
  const { months } = req.query;
  return typeof months === "string" ? Number(months) : fallback;
}

export const financialKpisHandler: RequestHandler = async (req, res) => {
  res.json(await service.getFinancialKpis(req.auth!.tenantId, parseCompanyId(req), parseRange(req)));
};

export const cashBreakdownHandler: RequestHandler = async (req, res) => {
  res.json(await service.getCashBreakdown(req.auth!.tenantId, parseCompanyId(req)));
};

export const cashFlowMonthlyHandler: RequestHandler = async (req, res) => {
  res.json(await service.getCashFlowMonthly(req.auth!.tenantId, parseCompanyId(req), parseMonths(req)));
};

export const topCashTransactionsHandler: RequestHandler = async (req, res) => {
  const { limit } = req.query;
  res.json(
    await service.getTopCashTransactions(req.auth!.tenantId, parseCompanyId(req), typeof limit === "string" ? Number(limit) : 10),
  );
};

export const financialPositionHandler: RequestHandler = async (req, res) => {
  const { asOfDate } = req.query;
  res.json(
    await service.getFinancialPosition(
      req.auth!.tenantId,
      parseCompanyId(req),
      typeof asOfDate === "string" ? new Date(asOfDate) : undefined,
    ),
  );
};

export const salesTrendHandler: RequestHandler = async (req, res) => {
  res.json(await service.getSalesTrend(req.auth!.tenantId, parseCompanyId(req), parseMonths(req)));
};

export const topCustomersHandler: RequestHandler = async (req, res) => {
  const { limit } = req.query;
  res.json(await service.getTopCustomers(req.auth!.tenantId, parseCompanyId(req), typeof limit === "string" ? Number(limit) : 10));
};

export const financialAlertsHandler: RequestHandler = async (req, res) => {
  res.json(await service.getFinancialAlerts(req.auth!.tenantId, parseCompanyId(req), parseWithinDays(req)));
};

export const hrKpisHandler: RequestHandler = async (req, res) => {
  res.json(await service.getHrKpis(req.auth!.tenantId, parseCompanyId(req)));
};

export const hrPayrollTrendHandler: RequestHandler = async (req, res) => {
  res.json(await service.getHrPayrollTrend(req.auth!.tenantId, parseCompanyId(req), parseMonths(req)));
};

export const hrHeadcountHandler: RequestHandler = async (req, res) => {
  res.json(await service.getHrHeadcountBreakdown(req.auth!.tenantId, parseCompanyId(req)));
};

export const hrNationalityHandler: RequestHandler = async (req, res) => {
  res.json(await service.getHrNationalityBreakdown(req.auth!.tenantId, parseCompanyId(req)));
};

export const hrAlertsHandler: RequestHandler = async (req, res) => {
  res.json(await service.getHrAlerts(req.auth!.tenantId, parseCompanyId(req), parseWithinDays(req)));
};
