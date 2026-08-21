import { RequestHandler } from "express";
import * as service from "./reports.service";

const parseDate = (v: unknown) => (typeof v === "string" && v ? new Date(v) : undefined);
const parseCompanyId = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const parseLevel = (v: unknown) => {
  const n = typeof v === "string" && v ? Number(v) : undefined;
  return n && n >= 1 && n <= 4 ? n : undefined;
};
const parseAccountId = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const parseCostCenterId = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const parseDepartmentId = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const parseBranchId = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const parseBool = (v: unknown) => v === "true" || v === "1";
const parseSearch = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const rollupParams = (query: Record<string, unknown>) => ({
  level: parseLevel(query.level),
  accountId: parseAccountId(query.accountId),
  includeDetails: parseBool(query.includeDetails),
  search: parseSearch(query.search),
});

export const trialBalanceHandler: RequestHandler = async (req, res) => {
  const result = await service.getTrialBalanceReport(
    req.auth!.tenantId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.from),
    parseDate(req.query.to),
    rollupParams(req.query),
    parseBranchId(req.query.branchId),
  );
  res.json(result);
};

export const trialBalanceTreeHandler: RequestHandler = async (req, res) => {
  const result = await service.getTrialBalanceTree(
    req.auth!.tenantId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.from),
    parseDate(req.query.to),
    { level: parseLevel(req.query.level), hideZeroActivity: parseBool(req.query.hideZeroActivity), search: parseSearch(req.query.search) },
    parseBranchId(req.query.branchId),
  );
  res.json(result);
};

export const incomeStatementHandler: RequestHandler = async (req, res) => {
  const result = await service.getIncomeStatement(
    req.auth!.tenantId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.from),
    parseDate(req.query.to),
    rollupParams(req.query),
    parseBranchId(req.query.branchId),
  );
  res.json(result);
};

export const balanceSheetHandler: RequestHandler = async (req, res) => {
  const result = await service.getBalanceSheet(
    req.auth!.tenantId,
    parseCompanyId(req.query.companyId),
    parseDate(req.query.date),
    rollupParams(req.query),
    parseBranchId(req.query.branchId),
  );
  res.json(result);
};

export const comprehensiveMonthlyHandler: RequestHandler = async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
  res.json(await service.getComprehensiveMonthlyReport(req.auth!.tenantId, parseCompanyId(req.query.companyId), month, req.lang));
};

export const updateMonthlyReportSettingsHandler: RequestHandler = async (req, res) => {
  const companyId = parseCompanyId(req.query.companyId);
  if (!companyId) return void res.status(400).json({ error: "يجب تحديد الشركة لحفظ حدود التنبيه" });
  res.json(await service.updateMonthlyReportSettings(req.auth!.tenantId, companyId, req.body));
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
    { costCenterId: parseCostCenterId(req.query.costCenterId), departmentId: parseDepartmentId(req.query.departmentId), branchId: parseBranchId(req.query.branchId) },
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
