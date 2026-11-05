import type { Account } from "@prisma/client";
import type { EffectiveClassification } from "./accountClassification";

/**
 * محرك التحليل المالي والنسب — دالة نقية فوق أرصدة الحسابات، بلا أي استعلام، حتى تُختبر الأرقام مباشرة.
 *
 * المدخلات ثلاث قراءات من aggregateAccountBalances (نفس مصدر ميزان المراجعة والقوائم): رصيد افتتاحي حتى
 * اليوم السابق لبداية الفترة، رصيد ختامي حتى نهايتها، وحركة الفترة بلا قيود الإقفال. متوسط أي رصيد =
 * (افتتاحي + ختامي) ÷ 2. أي نسبة مقامها صفر تعود null (تُعرَض "—") لا صفراً ولا ما لا نهاية.
 *
 * حدود معلنة (تظهر في التقرير):
 * - "الإيرادات" = حسابات الإيراد عدا ما دوره تكلفة تمويل (يشمل الإيرادات الأخرى).
 * - أيام السداد على تكلفة المبيعات لا المشتريات (المشتريات ليست حساباً في الشجرة).
 * - حقوق الملكية تشمل صافي الربح التراكمي حتى التاريخ، تماماً كقائمة المركز المالي.
 */

export interface BalanceDC {
  debit: number;
  credit: number;
}

export interface AnalysisInput {
  accounts: Pick<Account, "id" | "type" | "isPosting" | "isBankOrCash">[];
  effective: Map<string, EffectiveClassification>;
  opening: Map<string, BalanceDC>;
  closing: Map<string, BalanceDC>;
  flow: Map<string, BalanceDC>;
  days: number;
}

export interface PositionTotals {
  totalAssets: number;
  currentAssets: number;
  nonCurrentAssets: number;
  unclassifiedAssets: number;
  cash: number;
  receivables: number;
  inventory: number;
  totalLiabilities: number;
  currentLiabilities: number;
  nonCurrentLiabilities: number;
  unclassifiedLiabilities: number;
  payables: number;
  equity: number;
}

export interface FlowTotals {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  totalExpenses: number;
  depreciation: number;
  financeCost: number;
  netIncome: number;
  ebit: number;
  ebitda: number;
}

export type RatioUnit = "x" | "percent" | "days" | "amount";
export type RatioGroup = "liquidity" | "profitability" | "activity" | "leverage";

export interface RatioResult {
  key: string;
  group: RatioGroup;
  unit: RatioUnit;
  value: number | null;
}

const net = (b: BalanceDC | undefined) => (b ? b.debit - b.credit : 0);
const div = (a: number, b: number) => (Math.abs(b) < 0.005 ? null : a / b);
const avg = (a: number, b: number) => (a + b) / 2;
const round = (n: number | null, places = 4) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** places) / 10 ** places);

export function positionTotals(input: Pick<AnalysisInput, "accounts" | "effective">, balances: Map<string, BalanceDC>): PositionTotals {
  const t: PositionTotals = {
    totalAssets: 0,
    currentAssets: 0,
    nonCurrentAssets: 0,
    unclassifiedAssets: 0,
    cash: 0,
    receivables: 0,
    inventory: 0,
    totalLiabilities: 0,
    currentLiabilities: 0,
    nonCurrentLiabilities: 0,
    unclassifiedLiabilities: 0,
    payables: 0,
    equity: 0,
  };
  let cumulativeIncome = 0;
  for (const account of input.accounts) {
    if (!account.isPosting) continue;
    const n = net(balances.get(account.id));
    const cls = input.effective.get(account.id);
    if (account.type === "asset") {
      t.totalAssets += n;
      if (cls?.liquidity === "current") t.currentAssets += n;
      else if (cls?.liquidity === "non_current") t.nonCurrentAssets += n;
      else t.unclassifiedAssets += n;
      if (account.isBankOrCash) t.cash += n;
      if (cls?.analysisRole === "receivables") t.receivables += n;
      if (cls?.analysisRole === "inventory") t.inventory += n;
    } else if (account.type === "liability") {
      t.totalLiabilities -= n;
      if (cls?.liquidity === "current") t.currentLiabilities -= n;
      else if (cls?.liquidity === "non_current") t.nonCurrentLiabilities -= n;
      else t.unclassifiedLiabilities -= n;
      if (cls?.analysisRole === "payables") t.payables -= n;
    } else if (account.type === "equity") {
      t.equity -= n;
    } else {
      // إيراد/مصروف: صافي الربح التراكمي جزء من حقوق الملكية في المركز المالي
      cumulativeIncome -= n;
    }
  }
  t.equity += cumulativeIncome;
  return t;
}

export function flowTotals(input: Pick<AnalysisInput, "accounts" | "effective" | "flow">): FlowTotals {
  let revenue = 0;
  let totalRevenueAll = 0;
  let costOfSales = 0;
  let totalExpenses = 0;
  let depreciation = 0;
  let financeCost = 0;
  for (const account of input.accounts) {
    if (!account.isPosting) continue;
    const n = net(input.flow.get(account.id));
    const role = input.effective.get(account.id)?.analysisRole;
    if (account.type === "revenue") {
      totalRevenueAll -= n;
      if (role === "finance_cost") financeCost += n;
      else revenue -= n;
    } else if (account.type === "expense") {
      totalExpenses += n;
      if (role === "cost_of_sales") costOfSales += n;
      if (role === "depreciation") depreciation += n;
      if (role === "finance_cost") financeCost += n;
    }
  }
  const netIncome = totalRevenueAll - totalExpenses;
  const ebit = netIncome + financeCost;
  return {
    revenue,
    costOfSales,
    grossProfit: revenue - costOfSales,
    totalExpenses,
    depreciation,
    financeCost,
    netIncome,
    ebit,
    ebitda: ebit + depreciation,
  };
}

export function computeRatios(opening: PositionTotals, closing: PositionTotals, flow: FlowTotals, days: number): RatioResult[] {
  const avgAssets = avg(opening.totalAssets, closing.totalAssets);
  const avgEquity = avg(opening.equity, closing.equity);
  const avgReceivables = avg(opening.receivables, closing.receivables);
  const avgInventory = avg(opening.inventory, closing.inventory);
  const avgPayables = avg(opening.payables, closing.payables);
  const dso = div(avgReceivables * days, flow.revenue);
  const dio = div(avgInventory * days, flow.costOfSales);
  const dpo = div(avgPayables * days, flow.costOfSales);
  const r = (key: string, group: RatioGroup, unit: RatioUnit, value: number | null): RatioResult => ({
    key,
    group,
    unit,
    value: round(value, unit === "amount" ? 2 : 4),
  });
  return [
    r("currentRatio", "liquidity", "x", div(closing.currentAssets, closing.currentLiabilities)),
    r("quickRatio", "liquidity", "x", div(closing.currentAssets - closing.inventory, closing.currentLiabilities)),
    r("cashRatio", "liquidity", "x", div(closing.cash, closing.currentLiabilities)),
    r("workingCapital", "liquidity", "amount", closing.currentAssets - closing.currentLiabilities),

    r("grossMargin", "profitability", "percent", div(flow.grossProfit, flow.revenue)),
    r("ebitdaMargin", "profitability", "percent", div(flow.ebitda, flow.revenue)),
    r("netMargin", "profitability", "percent", div(flow.netIncome, flow.revenue)),
    r("returnOnAssets", "profitability", "percent", div(flow.netIncome, avgAssets)),
    r("returnOnEquity", "profitability", "percent", div(flow.netIncome, avgEquity)),

    r("assetTurnover", "activity", "x", div(flow.revenue, avgAssets)),
    r("receivableDays", "activity", "days", dso),
    r("inventoryDays", "activity", "days", dio),
    r("payableDays", "activity", "days", dpo),
    r("cashConversionCycle", "activity", "days", dso === null && dio === null ? null : (dso ?? 0) + (dio ?? 0) - (dpo ?? 0)),

    r("debtToEquity", "leverage", "x", div(closing.totalLiabilities, closing.equity)),
    r("debtRatio", "leverage", "percent", div(closing.totalLiabilities, closing.totalAssets)),
    r("equityRatio", "leverage", "percent", div(closing.equity, closing.totalAssets)),
    r("interestCoverage", "leverage", "x", div(flow.ebit, flow.financeCost)),
  ];
}

export interface UnclassifiedBalance {
  accountId: string;
  amount: number;
}

/** حسابات أصول/التزامات لها رصيد ختامي بلا تصنيف متداول/غير متداول فعلي — تجعل نسب السيولة ناقصة. */
export function unclassifiedBalances(input: Pick<AnalysisInput, "accounts" | "effective" | "closing">): UnclassifiedBalance[] {
  const rows: UnclassifiedBalance[] = [];
  for (const account of input.accounts) {
    if (!account.isPosting || (account.type !== "asset" && account.type !== "liability")) continue;
    if (input.effective.get(account.id)?.liquidity) continue;
    const n = net(input.closing.get(account.id));
    const amount = account.type === "asset" ? n : -n;
    if (Math.abs(amount) >= 0.005) rows.push({ accountId: account.id, amount });
  }
  return rows;
}

export function analyze(input: AnalysisInput) {
  const opening = positionTotals(input, input.opening);
  const closing = positionTotals(input, input.closing);
  const flow = flowTotals(input);
  const ratios = computeRatios(opening, closing, flow, input.days);
  const warnings: string[] = [];
  if (Math.abs(closing.unclassifiedAssets) >= 0.005 || Math.abs(closing.unclassifiedLiabilities) >= 0.005) warnings.push("unclassifiedLiquidity");
  if (flow.revenue > 0.005 && Math.abs(flow.costOfSales) < 0.005) warnings.push("noCostOfSales");
  if (Math.abs(closing.receivables) < 0.005 && Math.abs(opening.receivables) < 0.005 && flow.revenue > 0.005) warnings.push("noReceivables");
  return { opening, closing, flow, ratios, warnings };
}
