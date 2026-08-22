import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  getFinancialKpis, getCashBreakdown, getCashFlowMonthly, getTopCashTransactions,
  getFinancialPosition, getSalesTrend, getTopCustomers, getFinancialAlerts,
} from "../../api/dashboard";
import { fmt } from "../../legacy/constants";
import { getComprehensiveMonthly } from "../../api/reports";
import PeriodFilter from "./PeriodFilter";
import KpiCard from "./KpiCard";
import AlertsPanel from "./AlertsPanel";
import RecentActivity from "./RecentActivity";
import RecentEntriesTable from "./RecentEntriesTable";
import Banner from "../shared/Banner";
import { CHART_PALETTE, CHART_GRID, CHART_AXIS, CHART_FONT, chartTooltipStyle, colorAt, ATHAR_ACCENT_BLUE } from "./chartTheme";
import { currencyLabel } from "../../shared/countries";

const axisProps = { tick: { fontSize: 11.5, fill: CHART_AXIS, fontFamily: CHART_FONT }, axisLine: { stroke: CHART_GRID } };

const svgIcon = (children) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
// أيقونة دائرية لكل بطاقة KPI بحسب دلالة رقمها — نفس أسلوب أيقونات القائمة الجانبية (خطوط SVG
// بسيطة، viewBox 24x24، currentColor) حتى تبدو جزءاً من نفس لغة الأيقونات في التطبيق.
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

/**
 * محتوى الداشبورد المالية لسياق واحد (شركة محددة، أو المجموعة كاملة إن كان companyId فارغاً —
 * كل نقاط النهاية هنا تُرجع تجميعاً على مستوى المستأجر بأكمله حين لا يُمرَّر companyId، لأن
 * شجرة الحسابات مشتركة بين كل شركات المستأجر وتُفصَل فقط عبر الشركة المرتبطة بكل قيد).
 */
export default function FinancialDashboard({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState(null);
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
  const alertsRef = useRef(null);

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

  // أعجل تنبيه (الأقرب أجلاً/الأكثر تأخّراً) يُبرَز كـ Banner أعلى الصفحة — بلا أي استدعاء بيانات
  // إضافي، فقط عرض مختلف لأول عنصر من نفس alerts المحمَّلة أصلاً لـ AlertsPanel أدناه.
  const topAlert = alerts[0];
  const scrollToAlerts = () => alertsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div>
      <PeriodFilter onChange={setRange} />

      {loading || !kpis ? (
        <p className="empty">{t("dashboard.loading")}</p>
      ) : (
        <>
          {topAlert && (
            <Banner
              type={topAlert.days != null && topAlert.days < 0 ? "danger" : "warning"}
              title={topAlert.title}
              message={topAlert.detail}
              actionLabel={t("dashboard.banner.viewAllAlerts")}
              onAction={scrollToAlerts}
            />
          )}

          <div className="kpi-row">
            <KpiCard tone="revenue" icon={KPI_ICONS.revenue} label={t("dashboard.kpi.netSales")} value={`${fmt(kpis.salesCurrent)} ${currency}`} changePct={kpis.salesChangePct} changeLabel={t("dashboard.kpi.vsPreviousPeriod")} />
            <KpiCard tone="profit" icon={KPI_ICONS.profit} label={t("dashboard.kpi.netProfitEstimate")} value={`${fmt(kpis.netProfitEstimate)} ${currency}`} />
            <KpiCard tone="cash" icon={KPI_ICONS.cash} label={t("dashboard.kpi.cashBalance")} value={`${fmt(kpis.cashBalance)} ${currency}`} />
            <KpiCard tone="receivable" icon={KPI_ICONS.receivable} label={t("dashboard.kpi.receivables")} value={`${fmt(kpis.receivablesTotal)} ${currency}`} />
            <KpiCard tone="payable" icon={KPI_ICONS.payable} label={t("dashboard.kpi.payables")} value={`${fmt(kpis.payablesTotal)} ${currency}`} />
          </div>

          <div ref={alertsRef}>
            <AlertsPanel title={t("dashboard.alerts.title")} alerts={alerts} emptyText={t("dashboard.alerts.empty")} />
          </div>

          <div className="charts-grid">
            {monthly && <>
              <div className="panel chart-panel">
                <h3>{t("dashboard.charts.payrollAndDues")}</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={[
                    { label: t("dashboard.charts.paid"), value: monthly.payroll.paid },
                    { label: t("dashboard.charts.unpaid"), value: monthly.payroll.unpaid },
                    { label: t("dashboard.charts.endOfService"), value: monthly.payroll.endOfService },
                  ]}>
                    <CartesianGrid stroke={CHART_GRID} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ${currency}`} />
                    <Bar dataKey="value" fill={CHART_PALETTE[2]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="panel chart-panel">
                <h3>{t("dashboard.charts.agingTitle")}</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={[
                    { bucket: t("dashboard.charts.under30"), receivable: monthly.receivables.aging.under30, payable: monthly.payables.aging.under30 },
                    { bucket: t("dashboard.charts.d30to60"), receivable: monthly.receivables.aging.d30to60, payable: monthly.payables.aging.d30to60 },
                    { bucket: t("dashboard.charts.d60to90"), receivable: monthly.receivables.aging.d60to90, payable: monthly.payables.aging.d60to90 },
                    { bucket: t("dashboard.charts.over90"), receivable: monthly.receivables.aging.over90, payable: monthly.payables.aging.over90 },
                  ]}>
                    <CartesianGrid stroke={CHART_GRID} vertical={false} />
                    <XAxis dataKey="bucket" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...chartTooltipStyle} />
                    <Legend />
                    <Bar dataKey="receivable" name={t("dashboard.charts.receivable")} fill="#2F5D5A" />
                    <Bar dataKey="payable" name={t("dashboard.charts.payable")} fill="#A8432B" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="panel chart-panel">
                <h3>{t("dashboard.charts.monthComparisonTitle")}</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthly.comparison.slice(0, 3)}>
                    <CartesianGrid stroke={CHART_GRID} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...chartTooltipStyle} />
                    <Legend />
                    <Bar dataKey="current" name={t("dashboard.charts.current")} fill="#2F5D5A" />
                    <Bar dataKey="previous" name={t("dashboard.charts.previous")} fill="#B98B4E" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>}
            <div className="panel chart-panel">
              <h3>{t("dashboard.charts.salesTrendTitle")}</h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={salesTrend}>
                  <defs>
                    <linearGradient id="salesTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={ATHAR_ACCENT_BLUE} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={ATHAR_ACCENT_BLUE} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ${currency}`} />
                  <Area
                    type="monotone" dataKey="total" name={t("dashboard.charts.sales")}
                    stroke={ATHAR_ACCENT_BLUE} strokeWidth={2.5} fill="url(#salesTrendFill)"
                    dot={(dotProps) => {
                      const isLast = dotProps.index === salesTrend.length - 1;
                      return (
                        <circle
                          key={dotProps.index} cx={dotProps.cx} cy={dotProps.cy}
                          r={isLast ? 4.5 : 3} fill={ATHAR_ACCENT_BLUE}
                          stroke={isLast ? "#fff" : "none"} strokeWidth={isLast ? 2 : 0}
                        />
                      );
                    }}
                    activeDot={{ r: 5, fill: ATHAR_ACCENT_BLUE, stroke: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="panel chart-panel">
              <h3>{t("dashboard.charts.topCustomersTitle")}</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topCustomers} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                  <XAxis type="number" {...axisProps} />
                  <YAxis type="category" dataKey="customerName" width={110} {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ${currency}`} />
                  <Bar dataKey="netSales" name={t("dashboard.charts.netSales")} fill={CHART_PALETTE[1]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel chart-panel">
              <h3>{t("dashboard.charts.cashBreakdownTitle")}</h3>
              {cashBreakdown.length === 0 ? <p className="empty">{t("dashboard.charts.noCashAccounts")}</p> : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={cashBreakdown} dataKey="balance" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {cashBreakdown.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                    </Pie>
                    <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ${currency}`} />
                    <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="panel chart-panel">
              <h3>{t("dashboard.charts.monthlyCashFlowTitle")}</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={cashFlow}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ${currency}`} />
                  <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
                  <Bar dataKey="cashIn" name={t("dashboard.charts.cashIn")} fill="#2F5D5A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cashOut" name={t("dashboard.charts.cashOut")} fill="#A8432B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="two-col">
            <div className="panel">
              <h3>{t("dashboard.recentActivity.title")}</h3>
              <RecentActivity items={topTransactions} currency={currency} />
            </div>
            <div className="panel">
              <h3>{t("dashboard.recentEntries.title")}</h3>
              <RecentEntriesTable companyId={companyId} range={range} />
            </div>
          </div>

          {position && (
            <div className="panel">
              <h3>{t("dashboard.position.title")}</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { label: t("dashboard.position.assets"), value: position.totalAssets },
                    { label: t("dashboard.position.liabilities"), value: position.totalLiabilities },
                    { label: t("dashboard.position.equity"), value: position.totalEquity },
                  ]}
                >
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ${currency}`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {["#B98B4E", "#A8432B", "#2F5D5A"].map((c, i) => <Cell key={i} fill={c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
              <p className="empty" style={{ marginTop: 10, fontSize: 11.5 }}>
                {t("dashboard.position.currentRatioNote")}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
