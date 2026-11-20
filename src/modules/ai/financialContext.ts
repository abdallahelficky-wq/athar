import type { Request } from "express";
import { prisma } from "../../lib/prisma";
import { hrEntryKinds } from "../../lib/hrRedaction";
import { COUNTED_ENTRY_WHERE } from "../../lib/countedEntries";
import * as dashboard from "../dashboard/dashboard.service";
import {
  detectSeriesAnomalies, findDuplicateEntries, forecastSeries,
  type Anomaly, type DuplicateCandidate, type ForecastResult, type MonthPoint,
} from "./financialModel";

export type ScopeResult =
  | { ok: true; tenantId: string; companyId: string | undefined; dateFrom: Date; dateTo: Date }
  | { ok: false; status: number; error: string };

/**
 * النطاق يُشتَق من الرمز وحده: المستأجر دائماً من req.auth، والشركة إجبارية لمن نطاقه شركة واحدة، ويُتحقَّق من
 * أن الشركة المطلوبة تتبع المستأجر نفسه (عزل المستأجر — CLAUDE.md §4). لا يقبل أي نطاق من جسم الطلب.
 */
export async function resolveAiScope(
  req: Request,
  input: { companyId?: string; dateFrom?: string; dateTo?: string },
): Promise<ScopeResult> {
  const auth = req.auth;
  if (!auth || typeof auth.tenantId !== "string" || !auth.tenantId.trim()
    || typeof auth.companyScope !== "string" || !auth.companyScope.trim()) {
    return { ok: false, status: 401, error: "Invalid authentication scope" };
  }
  const tenantId = auth.tenantId;
  if (auth.companyScope !== "all" && input.companyId && input.companyId !== auth.companyScope) {
    return { ok: false, status: 403, error: "Company is outside your access scope" };
  }
  const companyId = auth.companyScope !== "all" ? auth.companyScope : input.companyId;
  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
    if (!company) return { ok: false, status: 404, error: "الشركة غير موجودة أو غير متاحة لهذا المستخدم" };
  }
  const dateTo = input.dateTo ? new Date(`${input.dateTo}T23:59:59.999Z`) : new Date();
  const dateFrom = input.dateFrom ? new Date(`${input.dateFrom}T00:00:00.000Z`)
    : new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), 1));
  if (dateFrom > dateTo) return { ok: false, status: 400, error: "dateFrom must not be after dateTo" };
  return { ok: true, tenantId, companyId, dateFrom, dateTo };
}

export interface Signals {
  basis: string;
  series: { revenue: MonthPoint[]; expense: MonthPoint[]; netCashFlow: MonthPoint[]; sales: MonthPoint[] };
  forecasts: { revenue: ForecastResult | null; expense: ForecastResult | null; netCashFlow: ForecastResult | null; sales: ForecastResult | null };
  anomalies: Anomaly[];
}

/** الشهر الجاري ناقص بطبيعته، فيُستبعَد من التوقع والشذوذ حتى لا يظهر كهبوط وهمي. */
function dropCurrentMonth(series: MonthPoint[]): MonthPoint[] {
  const current = new Date().toISOString().slice(0, 7);
  return series.filter((p) => p.month < current);
}

export function computeSignals(
  incomeExpense: Array<{ month: string; revenue: number; expense: number }>,
  cashFlow: Array<{ month: string; cashIn: number; cashOut: number }>,
  sales: Array<{ month: string; total: number }>,
): Signals {
  const series = {
    revenue: dropCurrentMonth(incomeExpense.map((r) => ({ month: r.month, value: r.revenue }))),
    expense: dropCurrentMonth(incomeExpense.map((r) => ({ month: r.month, value: r.expense }))),
    netCashFlow: dropCurrentMonth(cashFlow.map((r) => ({ month: r.month, value: Math.round((r.cashIn - r.cashOut) * 100) / 100 }))),
    sales: dropCurrentMonth(sales.map((r) => ({ month: r.month, value: r.total }))),
  };
  return {
    basis: "Completed calendar months only (the current partial month is excluded). Linear trend with damped slope; band is an ~80% interval. Anomalies use a robust median/MAD score (|z|>=3.5) and need >=6 active months.",
    series,
    forecasts: {
      revenue: forecastSeries(series.revenue), expense: forecastSeries(series.expense),
      netCashFlow: forecastSeries(series.netCashFlow), sales: forecastSeries(series.sales),
    },
    anomalies: [
      ...detectSeriesAnomalies("revenue", series.revenue), ...detectSeriesAnomalies("expense", series.expense),
      ...detectSeriesAnomalies("netCashFlow", series.netCashFlow), ...detectSeriesAnomalies("sales", series.sales),
    ],
  };
}

export async function loadSignals(tenantId: string, companyId: string | undefined): Promise<Signals> {
  const [incomeExpense, cashFlow, sales] = await Promise.all([
    dashboard.getIncomeExpenseTrend(tenantId, companyId),
    dashboard.getCashFlowMonthly(tenantId, companyId, 12),
    dashboard.getSalesTrend(tenantId, companyId, 12),
  ]);
  return computeSignals(incomeExpense, cashFlow, sales);
}

const DUPLICATE_WINDOW_DAYS = 90;
const DUPLICATE_SCAN_LIMIT = 5000;

/**
 * قيود محتمل تكرارها في آخر 90 يوماً. قيود الرواتب والتسويات (وما يعكسها أو يرايها) مستبعدة بالكامل حتى لا تصل
 * أي بيانات موظفين للنموذج أو للشاشة (قرار الموارد البشرية — hrRedaction). الاستعلام محصور بالمستأجر والشركة.
 */
export async function findRecentDuplicates(tenantId: string, companyId: string | undefined): Promise<{ items: DuplicateCandidate[]; scanned: number; truncated: boolean }> {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 86_400_000);
  const entries = await prisma.journalEntry.findMany({
    where: {
      AND: [COUNTED_ENTRY_WHERE, { sourceModule: { notIn: ["fiscal_year_closing"] } }],
      tenantId, companyId: companyId || undefined, date: { gte: since },
    },
    orderBy: { date: "desc" },
    take: DUPLICATE_SCAN_LIMIT + 1,
    select: {
      id: true, entryNumber: true, companyId: true, date: true, memo: true, sourceModule: true, reversalOfEntryId: true, mirrorEntryId: true,
      lines: { select: { debit: true } },
    },
  });
  const truncated = entries.length > DUPLICATE_SCAN_LIMIT;
  const scanned = entries.slice(0, DUPLICATE_SCAN_LIMIT);
  const hr = await hrEntryKinds(tenantId, scanned);
  const rows = scanned
    .filter((e) => !hr.has(e.id))
    // قيد معكوس أو عاكس ينسخ أسطر الأصل عمداً — ليس تكراراً.
    .filter((e) => !e.reversalOfEntryId && !e.mirrorEntryId)
    .map((e) => ({
      id: e.id, entryNumber: e.entryNumber, companyId: e.companyId, date: e.date, memo: e.memo,
      total: e.lines.reduce((s, l) => s + Number(l.debit), 0),
    }));
  return { items: findDuplicateEntries(rows).slice(0, 20), scanned: scanned.length, truncated };
}

export async function buildFinancialContext(
  scope: { tenantId: string; companyId: string | undefined; dateFrom: Date; dateTo: Date },
  lang: "ar" | "en",
) {
  const { tenantId, companyId, dateFrom, dateTo } = scope;
  const [kpis, financialPosition, cashBreakdown, cashFlow, salesTrend, topCustomers, alerts, signals] = await Promise.all([
    dashboard.getFinancialKpis(tenantId, companyId, { dateFrom, dateTo }),
    dashboard.getFinancialPosition(tenantId, companyId, dateTo),
    dashboard.getCashBreakdown(tenantId, companyId),
    dashboard.getCashFlowMonthly(tenantId, companyId, 6),
    dashboard.getSalesTrend(tenantId, companyId, 6),
    dashboard.getTopCustomers(tenantId, companyId, 5),
    dashboard.getFinancialAlerts(tenantId, companyId, 60, lang),
    loadSignals(tenantId, companyId),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    periods: {
      kpis: "Sales and profit use the requested range; cash and aging balances are current",
      financialPosition: "Balance sheet at dateTo; currentRatioProxy uses current cash and aging balances",
      cashBreakdown: "Current balances",
      cashFlow: "Last six calendar months ending in the current month",
      salesTrend: "Last six calendar months ending in the current month",
      topCustomers: "All posted sales to date",
      alerts: "Current alerts with a 60-day lookahead",
      signals: "Last twelve completed calendar months (see signals.basis)",
    },
    scope: { companyId: companyId ?? "all", dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
    kpis, financialPosition, cashBreakdown, cashFlow, salesTrend, topCustomers,
    alerts: alerts.slice(0, 20),
    signals,
  };
}
