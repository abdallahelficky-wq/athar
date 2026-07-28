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

export const customerStatementHandler: RequestHandler = async (req, res) => {
  const result = await service.getCustomerStatement(
    req.auth!.tenantId,
    req.params.customerId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.from),
    parseDate(req.query.to),
  );
  res.json(result);
};

export const accountLedgerHandler: RequestHandler = async (req, res) => {
  const result = await service.getAccountLedger(
    req.auth!.tenantId,
    req.params.accountId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.from),
    parseDate(req.query.to),
  );
  res.json(result);
};

export const supplierStatementHandler: RequestHandler = async (req, res) => {
  const result = await service.getSupplierStatement(
    req.auth!.tenantId,
    req.params.supplierId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.from),
    parseDate(req.query.to),
  );
  res.json(result);
};
