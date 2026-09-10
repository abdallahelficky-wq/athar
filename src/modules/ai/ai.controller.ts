import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import * as dashboard from "../dashboard/dashboard.service";
import { askAtharAi } from "./ai.service";
import { z } from "zod";

const askSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  companyId: z.string().trim().min(1).max(200).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
}).strict();

export const askAiHandler: RequestHandler = async (req, res) => {
  if (!req.auth || typeof req.auth.tenantId !== "string" || !req.auth.tenantId.trim()
    || typeof req.auth.companyScope !== "string" || !req.auth.companyScope.trim()) {
    res.status(401).json({ error: "Invalid authentication scope" });
    return;
  }
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: only question, companyId, dateFrom and dateTo are accepted" });
    return;
  }
  const { question } = parsed.data;
  const tenantId = req.auth!.tenantId;
  const requestedCompanyId = parsed.data.companyId;
  if (req.auth.companyScope !== "all" && requestedCompanyId && requestedCompanyId !== req.auth.companyScope) {
    res.status(403).json({ error: "Company is outside your access scope" });
    return;
  }
  const companyId = req.auth!.companyScope !== "all" ? req.auth!.companyScope : requestedCompanyId;

  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
    if (!company) {
      res.status(404).json({ error: "الشركة غير موجودة أو غير متاحة لهذا المستخدم" });
      return;
    }
  }

  const dateTo = parsed.data.dateTo ? new Date(`${parsed.data.dateTo}T23:59:59.999Z`) : new Date();
  const dateFrom = parsed.data.dateFrom ? new Date(`${parsed.data.dateFrom}T00:00:00.000Z`)
    : new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), 1));
  if (dateFrom > dateTo) {
    res.status(400).json({ error: "dateFrom must not be after dateTo" });
    return;
  }
  const range = { dateFrom, dateTo };

  const [kpis, financialPosition, cashBreakdown, cashFlow, salesTrend, topCustomers, alerts] = await Promise.all([
    dashboard.getFinancialKpis(tenantId, companyId, range),
    dashboard.getFinancialPosition(tenantId, companyId, dateTo),
    dashboard.getCashBreakdown(tenantId, companyId),
    dashboard.getCashFlowMonthly(tenantId, companyId, 6),
    dashboard.getSalesTrend(tenantId, companyId, 6),
    dashboard.getTopCustomers(tenantId, companyId, 5),
    dashboard.getFinancialAlerts(tenantId, companyId, 60, req.lang),
  ]);

  const context = {
    generatedAt: new Date().toISOString(),
    periods: {
      kpis: "Sales and profit use the requested range; cash and aging balances are current",
      financialPosition: "Balance sheet at dateTo; currentRatioProxy uses current cash and aging balances",
      cashBreakdown: "Current balances",
      cashFlow: "Last six calendar months ending in the current month",
      salesTrend: "Last six calendar months ending in the current month",
      topCustomers: "All posted sales to date",
      alerts: "Current alerts with a 60-day lookahead",
    },
    scope: { companyId: companyId ?? "all", dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
    kpis,
    financialPosition,
    cashBreakdown,
    cashFlow,
    salesTrend,
    topCustomers,
    alerts: alerts.slice(0, 20),
  };

  const result = await askAtharAi(question, context);
  res.json({ ...result, scope: context.scope });
};
