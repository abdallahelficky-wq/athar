import { RequestHandler } from "express";
import * as service from "./reports.service";

const parseDate = (v: unknown) => (typeof v === "string" && v ? new Date(v) : undefined);
const parseCompanyId = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const trialBalanceHandler: RequestHandler = async (req, res) => {
  const result = await service.getTrialBalance(
    req.auth!.tenantId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.date),
  );
  res.json(result);
};

export const incomeStatementHandler: RequestHandler = async (req, res) => {
  const result = await service.getIncomeStatement(
    req.auth!.tenantId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.from),
    parseDate(req.query.to),
  );
  res.json(result);
};

export const balanceSheetHandler: RequestHandler = async (req, res) => {
  const result = await service.getBalanceSheet(
    req.auth!.tenantId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.date),
  );
  res.json(result);
};
