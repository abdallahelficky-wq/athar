import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  getFinancialKpis, getCashBreakdown, getCashFlowMonthly, getTopCashTransactions,
  getFinancialPosition, getSalesTrend, getTopCustomers, getFinancialAlerts,
} from "../../api/dashboard";
import { fmt } from "../../legacy/constants";
import PeriodFilter from "./PeriodFilter";
import KpiCard from "./KpiCard";
import AlertsPanel from "./AlertsPanel";
import { CHART_PALETTE, CHART_GRID, CHART_AXIS, CHART_FONT, chartTooltipStyle, colorAt } from "./chartTheme";

const axisProps = { tick: { fontSize: 11.5, fill: CHART_AXIS, fontFamily: CHART_FONT }, axisLine: { stroke: CHART_GRID } };

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
export default function FinancialDashboard({ companyId }) {
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
    ])
      .then(([k, cb, cf, tt, pos, st, tc, al]) => {
        setKpis(k); setCashBreakdown(cb); setCashFlow(cf); setTopTransactions(tt);
        setPosition(pos); setSalesTrend(st); setTopCustomers(tc); setAlerts(al);
      })
      .finally(() => setLoading(false));
  }, [companyId, range]);

  return (
    <div>
      <PeriodFilter onChange={setRange} />

      {loading || !kpis ? (
        <p className="empty">جارٍ التحميل...</p>
      ) : (
        <>
          <div className="kpi-row">
            <KpiCard label="صافي المبيعات (الفترة المختارة)" value={`${fmt(kpis.salesCurrent)} ر.س`} changePct={kpis.salesChangePct} changeLabel="عن الفترة السابقة" />
            <KpiCard label="صافي الربح التقديري" value={`${fmt(kpis.netProfitEstimate)} ر.س`} />
            <KpiCard label="الرصيد النقدي الحالي" value={`${fmt(kpis.cashBalance)} ر.س`} />
            <KpiCard label="مستحقات على العملاء" value={`${fmt(kpis.receivablesTotal)} ر.س`} />
            <KpiCard label="مستحقات للموردين" value={`${fmt(kpis.payablesTotal)} ر.س`} />
          </div>

          <AlertsPanel title="⚠ أهم التنبيهات" alerts={alerts} emptyText="لا توجد تنبيهات حالياً." />

          <div className="charts-grid">
            <div className="panel chart-panel">
              <h3>اتجاه المبيعات (آخر ١٢ شهراً)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={salesTrend}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ر.س`} />
                  <Line type="monotone" dataKey="total" name="المبيعات" stroke={CHART_PALETTE[0]} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="panel chart-panel">
              <h3>أفضل ١٠ عملاء (حسب صافي المبيعات)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topCustomers} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                  <XAxis type="number" {...axisProps} />
                  <YAxis type="category" dataKey="customerName" width={110} {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ر.س`} />
                  <Bar dataKey="netSales" name="صافي المبيعات" fill={CHART_PALETTE[1]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel chart-panel">
              <h3>توزيع الكاش على الحسابات</h3>
              {cashBreakdown.length === 0 ? <p className="empty">لا توجد حسابات نقدية/بنكية مصنَّفة.</p> : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={cashBreakdown} dataKey="balance" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {cashBreakdown.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                    </Pie>
                    <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ر.س`} />
                    <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="panel chart-panel">
              <h3>حركة الكاش الشهرية (وارد مقابل صادر)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={cashFlow}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ر.س`} />
                  <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
                  <Bar dataKey="cashIn" name="وارد" fill="#2F5D5A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cashOut" name="صادر" fill="#A8432B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3>أعلى حركات الكاش (آخر ١٨٠ يوماً)</h3>
            {topTransactions.length === 0 ? <p className="empty">لا توجد حركات كاش بعد.</p> : (
              <table className="ledger-table">
                <thead><tr><th>التاريخ</th><th>البيان</th><th>الحساب</th><th>المبلغ</th><th>الاتجاه</th></tr></thead>
                <tbody>
                  {topTransactions.map((t, i) => (
                    <tr key={i}>
                      <td>{t.date.slice(0, 10)}</td>
                      <td>{t.memo}</td>
                      <td>{t.accountName}</td>
                      <td className="num">{fmt(Math.abs(t.amount))} ر.س</td>
                      <td className={t.direction === "in" ? "balance-ok" : "balance-bad"}>{t.direction === "in" ? "وارد" : "صادر"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {position && (
            <div className="panel">
              <h3>المركز المالي للمنشأة</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { label: "الأصول", value: position.totalAssets },
                    { label: "الالتزامات", value: position.totalLiabilities },
                    { label: "حقوق الملكية", value: position.totalEquity },
                  ]}
                >
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ر.س`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {["#B98B4E", "#A8432B", "#2F5D5A"].map((c, i) => <Cell key={i} fill={c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="ratio-row">
                <div className={`ratio-chip ratio-chip-${ratioTone("debtToEquity", position.debtToEquity)}`}>
                  نسبة الديون لحقوق الملكية
                  <div className="ratio-value">{position.debtToEquity == null ? "—" : position.debtToEquity.toFixed(2)}</div>
                </div>
                <div className={`ratio-chip ratio-chip-${ratioTone("currentRatio", position.currentRatioProxy)}`}>
                  نسبة التداول (تقريبية)
                  <div className="ratio-value">{position.currentRatioProxy == null ? "—" : position.currentRatioProxy.toFixed(2)}</div>
                </div>
              </div>
              <p className="empty" style={{ marginTop: 10, fontSize: 11.5 }}>
                * نسبة التداول هنا تقريبية (كاش + ذمم مدينة ÷ ذمم دائنة) لعدم وجود تصنيف "متداول/غير متداول" في شجرة الحسابات حالياً.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
