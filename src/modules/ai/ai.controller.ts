import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import * as dashboard from "../dashboard/dashboard.service";
import { askAtharAi } from "./ai.service";

function parseDate(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export const askAiHandler: RequestHandler = async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "السؤال مطلوب" });
    return;
  }
  if (question.length > 4000) {
    res.status(400).json({ error: "السؤال أطول من الحد المسموح" });
    return;
  }

  const tenantId = req.auth!.tenantId;
  const requestedCompanyId = typeof req.body?.companyId === "string" && req.body.companyId ? req.body.companyId : undefined;
  const companyId = req.auth!.companyScope !== "all" ? req.auth!.companyScope : requestedCompanyId;

  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
    if (!company) {
      res.status(404).json({ error: "الشركة غير موجودة أو غير متاحة لهذا المستخدم" });
      return;
    }
  }

  const dateTo = parseDate(req.body?.dateTo, new Date());
  const dateFrom = parseDate(req.body?.dateFrom, new Date(dateTo.getFullYear(), dateTo.getMonth(), 1));
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
