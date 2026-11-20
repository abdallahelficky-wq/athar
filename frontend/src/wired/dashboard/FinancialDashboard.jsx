import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  getFinancialKpis, getCashBreakdown, getCashFlowMonthly, getTopCashTransactions,
  getFinancialPosition, getSalesTrend, getTopCustomers, getFinancialAlerts,
} from "../../api/dashboard";
import { fmt } from "../../legacy/constants";
import { getComprehensiveMonthly } from "../../api/reports";
import IncomeExpenseChart from "./IncomeExpenseChart";
import RecentActivity from "./RecentActivity";
import RecentEntriesTable from "./RecentEntriesTable";
import { DashCard, DashKpi, DashAlerts, Sparkline, compactNumber } from "./DashParts";
import { CHART_GRID, CHART_AXIS, CHART_FONT, chartTooltipStyle, colorAt } from "./chartTheme";
import { currencyLabel } from "../../shared/countries";

const axisProps = { tick: { fontSize: 11.5, fill: CHART_AXIS, fontFamily: CHART_FONT }, axisLine: { stroke: CHART_GRID }, tickLine: false };
const yAxisProps = { ...axisProps, width: 56, tickFormatter: compactNumber, axisLine: false };
const cursorProps = { cursor: { fill: "rgba(67,56,202,0.06)" } };
const INDIGO = "#4338CA";
const GREEN = "#1B8354";
const RUST = "#A8432B";
const AMBER = "#B7791F";

const svgIcon = (children) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
// أيقونات المؤشرات — نفس أسلوب أيقونات القائمة الجانبية (خطوط SVG بسيطة، viewBox 24x24، currentColor)
const KPI_ICONS = {
  revenue: svgIcon(<><path d="M3 17l5-5 4 4 8-8" /><path d="M14 8h6v6" /></>),
  profit: svgIcon(<><circle cx="12" cy="12" r="9" /><path d="M8 13c0 0 1.5 2.5 4 2.5S16 13 16 13" /><circle cx="9" cy="9.5" r="0.9" fill="currentColor" stroke="none" /><circle cx="15" cy="9.5" r="0.9" fill="currentColor" stroke="none" /></>),
  cash: svgIcon(<><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19" /><circle cx="17.5" cy="14.5" r="1.6" /></>),
  receivable: svgIcon(<><path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z" /><path d="M9 8h6M9 12h6" /></>),
  payable: svgIcon(<><path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z" /><path d="M9 8h6M9 12h6" /></>),
};

function ratioTone(kind, value) {
  if (value == null) return "warn";
  if (kind === "debtToEquity") return value <= 1 ? "good" : value <= 2 ? "warn" : "bad";
  return value >= 1.5 ? "good" : value >= 1 ? "warn" : "bad";
}

// الرسوم تُرسم دائماً LTR (محور الزمن من اليسار) بغضّ النظر عن اتجاه الصفحة
const Chart = ({ children }) => <div dir="ltr">{children}</div>;

const gradient = (id, color) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor={color} stopOpacity={1} />
    <stop offset="100%" stopColor={color} stopOpacity={0.62} />
  </linearGradient>
);

/**
 * محتوى الداشبورد المالية لسياق واحد (شركة محددة، أو المجموعة كاملة إن كان companyId فارغاً —
 * كل نقاط النهاية هنا تُرجع تجميعاً على مستوى المستأجر بأكمله حين لا يُمرَّر companyId، لأن
 * شجرة الحسابات مشتركة بين كل شركات المستأجر وتُفصَل فقط عبر الشركة المرتبطة بكل قيد).
 * الفترة (range) تأتي من رأس الصفحة (Dashboard.jsx) — نفس الاستدعاءات والبيانات كسابقاً.
 */
export default function FinancialDashboard({ companyId, companies, range }) {
  const { t, i18n } = useTranslation();
  const [kpis, setKpis] = useState(null);
  const [cashBreakdown, setCashBreakdown] = useState([]);
  const [cashFlow, setCashFlow] = useState([]);
  const [topTransactions, setTopTransactions] = useState([]);
  const [position, setPosition] = useState(null);
  const [salesTrend, setSalesTrend] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthly, setMonthly] = useState(null);

  useEffect(() => {
    if (!range) return;
    setLoading(true);
    Promise.all([
      getFinancialKpis(companyId, range.dateFrom, range.dateTo),
      getCashBreakdown(companyId),
      getCashFlowMonthly(companyId),
      getTopCashTransactions(companyId, 8),
      getFinancialPosition(companyId),
      getSalesTrend(companyId),
      getTopCustomers(companyId, 10),
      getFinancialAlerts(companyId, 60),
      getComprehensiveMonthly({ companyId, month: range.dateTo.slice(0, 7) }),
    ])
      .then(([k, cb, cf, tt, pos, st, tc, al, mr]) => {
        setKpis(k); setCashBreakdown(cb); setCashFlow(cf); setTopTransactions(tt);
        setPosition(pos); setSalesTrend(st); setTopCustomers(tc); setAlerts(al);
        setMonthly(mr);
      })
      .finally(() => setLoading(false));
  }, [companyId, range]);

  // شركة محدَّدة: عملتها. عرض موحَّد (بلا companyId): لا عملة واحدة صحيحة فعلياً، فتبقى التسمية
  // الافتراضية كسابقاً بلا تغيير سلوك — نفس منطق ComprehensiveMonthlyReport.jsx.
  const currency = companyId ? currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language) : t("common.currency");
  const money = (v) => `${fmt(v)} ${currency}`;

  if (loading || !kpis) {
    return (
      <>
        <div className="ls-kpis dash-kpis is-loading" role="status" aria-label={t("dashboard.loading")}>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="ls-kpi dash-skel"><div className="ls-kpi-label">&nbsp;</div><div className="ls-kpi-value">—</div></div>)}
        </div>
        <p className="empty">{t("dashboard.loading")}</p>
      </>
    );
  }

  const margin = kpis.salesCurrent > 0 ? (kpis.netProfitEstimate / kpis.salesCurrent) * 100 : null;
  const cashTotal = cashBreakdown.reduce((s, c) => s + Number(c.balance || 0), 0);
  const cashFlowNet = cashFlow.map((r) => ({ ...r, net: (r.cashIn || 0) - (r.cashOut || 0) }));
  const topMax = Math.max(1, ...topCustomers.map((c) => Number(c.netSales) || 0));

  return (
    <>
      <div className="ls-kpis dash-kpis">
        <DashKpi tone="green" icon={KPI_ICONS.revenue} label={t("dashboard.kpi.netSales")} value={fmt(kpis.salesCurrent)} currency={currency}
          changePct={kpis.salesChangePct} changeLabel={t("dashboard.kpi.vsPreviousPeriod")} spark={<Sparkline values={salesTrend.map((r) => r.total)} />} />
        <DashKpi tone="blue" icon={KPI_ICONS.profit} label={t("dashboard.kpi.netProfitEstimate")} value={fmt(kpis.netProfitEstimate)} currency={currency}
          sub={margin != null ? t("dashboard.screen.margin", { pct: margin.toFixed(1) }) : null} />
        <DashKpi tone="teal" icon={KPI_ICONS.cash} label={t("dashboard.kpi.cashBalance")} value={fmt(kpis.cashBalance)} currency={currency} />
        <DashKpi tone="amber" icon={KPI_ICONS.receivable} label={t("dashboard.kpi.receivables")} value={fmt(kpis.receivablesTotal)} currency={currency} />
        <DashKpi tone="red" icon={KPI_ICONS.payable} label={t("dashboard.kpi.payables")} value={fmt(kpis.payablesTotal)} currency={currency} />
      </div>

      <DashAlerts alerts={alerts} emptyText={t("dashboard.alerts.empty")} />

      <div className="dash-grid">
        <IncomeExpenseChart companyId={companyId} currency={currency} />

        <DashCard span={4} tone="teal" title={t("dashboard.charts.cashBreakdownTitle")}>
          {cashBreakdown.length === 0 ? <p className="empty">{t("dashboard.charts.noCashAccounts")}</p> : (
            <div className="dash-donut">
              <div className="dash-donut-chart" dir="ltr">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={cashBreakdown} dataKey="balance" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={2} stroke="none">
                      {cashBreakdown.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                    </Pie>
                    <Tooltip {...chartTooltipStyle} formatter={(v) => money(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dash-donut-center"><span>{t("dashboard.screen.cashTotal")}</span><b>{compactNumber(cashTotal)}</b></div>
              </div>
              <ul className="dash-legend">
                {cashBreakdown.map((c, i) => (
                  <li key={i}>
                    <i style={{ background: colorAt(i) }} />
                    <span>{c.name}</span>
                    <b>{fmt(c.balance)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DashCard>

        <DashCard span={6} tone="blue" title={t("dashboard.charts.salesTrendTitle")}>
          <Chart>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={salesTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashSalesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={INDIGO} stopOpacity={0.32} />
                    <stop offset="95%" stopColor={INDIGO} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 4" />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...yAxisProps} />
                <Tooltip {...chartTooltipStyle} formatter={(v) => money(v)} />
                <Area
                  type="monotone" dataKey="total" name={t("dashboard.charts.sales")}
                  stroke={INDIGO} strokeWidth={3} fill="url(#dashSalesFill)"
                  dot={(dotProps) => {
                    const isLast = dotProps.index === salesTrend.length - 1;
                    return (
                      <circle
                        key={dotProps.index} cx={dotProps.cx} cy={dotProps.cy}
                        r={isLast ? 5 : 3} fill={INDIGO}
                        stroke={isLast ? "#fff" : "none"} strokeWidth={isLast ? 2 : 0}
                      />
                    );
                  }}
                  activeDot={{ r: 6, fill: INDIGO, stroke: "#fff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Chart>
        </DashCard>

        <DashCard span={6} tone="green" title={t("dashboard.charts.monthlyCashFlowTitle")}>
          <Chart>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={cashFlowNet} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>{gradient("dashIn", GREEN)}{gradient("dashOut", RUST)}</defs>
                <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 4" />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...yAxisProps} />
                <Tooltip {...chartTooltipStyle} {...cursorProps} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: CHART_FONT }} />
                <Bar dataKey="cashIn" name={t("dashboard.charts.cashIn")} fill="url(#dashIn)" radius={[6, 6, 0, 0]} maxBarSize={22} />
                <Bar dataKey="cashOut" name={t("dashboard.charts.cashOut")} fill="url(#dashOut)" radius={[6, 6, 0, 0]} maxBarSize={22} />
                <Line type="monotone" dataKey="net" name={t("dashboard.screen.netFlow")} stroke={AMBER} strokeWidth={2.5} dot={{ r: 3, fill: AMBER, strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </Chart>
        </DashCard>

        <DashCard span={5} tone="amber" title={t("dashboard.charts.topCustomersTitle")} note={t("dashboard.screen.topCustomersNote")}>
          {topCustomers.length === 0 ? <p className="empty">—</p> : (
            <ol className="dash-rank">
              {topCustomers.map((c, i) => (
                <li key={`${c.customerName}-${i}`}>
                  <span className={`dash-rank-n${i < 3 ? ` top-${i + 1}` : ""}`}>{i + 1}</span>
                  <div className="dash-rank-main">
                    <div className="dash-rank-row"><span className="dash-rank-name">{c.customerName}</span><b>{fmt(c.netSales)}</b></div>
                    <div className="dash-bar"><span style={{ width: `${Math.max(3, ((Number(c.netSales) || 0) / topMax) * 100)}%` }} /></div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DashCard>

        {monthly && (
          <DashCard span={7} tone="red" title={t("dashboard.charts.agingTitle")}>
            <Chart>
              <ResponsiveContainer width="100%" height={270}>
                <BarChart margin={{ top: 10, right: 12, left: 0, bottom: 0 }} data={[
                  { bucket: t("dashboard.charts.under30"), receivable: monthly.receivables.aging.under30, payable: monthly.payables.aging.under30 },
                  { bucket: t("dashboard.charts.d30to60"), receivable: monthly.receivables.aging.d30to60, payable: monthly.payables.aging.d30to60 },
                  { bucket: t("dashboard.charts.d60to90"), receivable: monthly.receivables.aging.d60to90, payable: monthly.payables.aging.d60to90 },
                  { bucket: t("dashboard.charts.over90"), receivable: monthly.receivables.aging.over90, payable: monthly.payables.aging.over90 },
                ]}>
                  <defs>{gradient("dashRec", GREEN)}{gradient("dashPay", RUST)}</defs>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 4" />
                  <XAxis dataKey="bucket" {...axisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip {...chartTooltipStyle} {...cursorProps} formatter={(v) => money(v)} />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: CHART_FONT }} />
                  <Bar dataKey="receivable" name={t("dashboard.charts.receivable")} fill="url(#dashRec)" radius={[6, 6, 0, 0]} maxBarSize={34} />
                  <Bar dataKey="payable" name={t("dashboard.charts.payable")} fill="url(#dashPay)" radius={[6, 6, 0, 0]} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
          </DashCard>
        )}

        {monthly && (
          <DashCard span={4} tone="blue" title={t("dashboard.charts.monthComparisonTitle")}>
            <Chart>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthly.comparison.slice(0, 3)} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <defs>{gradient("dashCur", INDIGO)}{gradient("dashPrev", "#B98B4E")}</defs>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 4" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip {...chartTooltipStyle} {...cursorProps} formatter={(v) => money(v)} />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: CHART_FONT }} />
                  <Bar dataKey="current" name={t("dashboard.charts.current")} fill="url(#dashCur)" radius={[6, 6, 0, 0]} maxBarSize={30} />
                  <Bar dataKey="previous" name={t("dashboard.charts.previous")} fill="url(#dashPrev)" radius={[6, 6, 0, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
          </DashCard>
        )}

        {monthly && (
          <DashCard span={4} tone="gray" title={t("dashboard.charts.payrollAndDues")}>
            <Chart>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart margin={{ top: 10, right: 8, left: 0, bottom: 0 }} data={[
                  { label: t("dashboard.charts.paid"), value: monthly.payroll.paid },
                  { label: t("dashboard.charts.unpaid"), value: monthly.payroll.unpaid },
                  { label: t("dashboard.charts.endOfService"), value: monthly.payroll.endOfService },
                ]}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 4" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip {...chartTooltipStyle} {...cursorProps} formatter={(v) => money(v)} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {[GREEN, AMBER, INDIGO].map((c, i) => <Cell key={i} fill={c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Chart>
          </DashCard>
        )}

        {position && (
          <DashCard span={4} tone="teal" title={t("dashboard.position.title")}>
            <Chart>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart
                  margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
                  data={[
                    { label: t("dashboard.position.assets"), value: position.totalAssets },
                    { label: t("dashboard.position.liabilities"), value: position.totalLiabilities },
                    { label: t("dashboard.position.equity"), value: position.totalEquity },
                  ]}
                >
                  <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 4" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip {...chartTooltipStyle} {...cursorProps} formatter={(v) => money(v)} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {["#B98B4E", RUST, GREEN].map((c, i) => <Cell key={i} fill={c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Chart>
            <div className="ratio-row">
              <div className={`ratio-chip ratio-chip-${ratioTone("debtToEquity", position.debtToEquity)}`}>
                {t("dashboard.position.debtToEquity")}
                <div className="ratio-value">{position.debtToEquity == null ? "—" : position.debtToEquity.toFixed(2)}</div>
              </div>
              <div className={`ratio-chip ratio-chip-${ratioTone("currentRatio", position.currentRatioProxy)}`}>
                {t("dashboard.position.currentRatio")}
                <div className="ratio-value">{position.currentRatioProxy == null ? "—" : position.currentRatioProxy.toFixed(2)}</div>
              </div>
            </div>
            <p className="dash-note">{t("dashboard.position.currentRatioNote")}</p>
          </DashCard>
        )}

        <DashCard span={5} tone="green" title={t("dashboard.recentActivity.title")}>
          <RecentActivity items={topTransactions} currency={currency} />
        </DashCard>
        <DashCard span={7} tone="blue" title={t("dashboard.recentEntries.title")}>
          <RecentEntriesTable companyId={companyId} range={range} />
        </DashCard>
      </div>
    </>
  );
}
