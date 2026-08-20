import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { getHrKpis, getHrPayrollTrend, getHrHeadcount, getHrNationality, getHrAlerts } from "../../api/dashboard";
import { fmt } from "../../legacy/constants";
import KpiCard from "../dashboard/KpiCard";
import AlertsPanel from "../dashboard/AlertsPanel";
import { CHART_PALETTE, CHART_GRID, CHART_AXIS, CHART_FONT, chartTooltipStyle, colorAt } from "../dashboard/chartTheme";
import { currencyLabel } from "../../shared/countries";

const axisProps = { tick: { fontSize: 11.5, fill: CHART_AXIS, fontFamily: CHART_FONT }, axisLine: { stroke: CHART_GRID } };

/**
 * داشبورد شئون الموظفين — أول تبويب في قسم "شئون الموظفين"، نفس مبدأ الداشبورد المالية
 * (تحترم الشركة النشطة/عرض المجموعة كاملة عبر companyId فارغ = تجميع على مستوى المستأجر).
 */
export default function HRDashboardTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const [kpis, setKpis] = useState(null);
  const [payrollTrend, setPayrollTrend] = useState([]);
  const [headcount, setHeadcount] = useState([]);
  const [nationality, setNationality] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getHrKpis(companyId),
      getHrPayrollTrend(companyId),
      getHrHeadcount(companyId),
      getHrNationality(companyId),
      getHrAlerts(companyId, 60),
    ])
      .then(([k, pt, hc, nat, al]) => {
        setKpis(k); setPayrollTrend(pt); setHeadcount(hc); setNationality(nat); setAlerts(al);
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading || !kpis) return <p className="empty">{t("common.loading")}</p>;

  const currency = companyId ? currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language) : t("common.currency");
  const employeeUnit = t("hr.dashboard.employee");
  const daysUnit = t("hr.dashboard.days");

  return (
    <div>
      <div className="kpi-row">
        <KpiCard label={t("hr.dashboard.activeEmployeeCount")} value={kpis.activeEmployeeCount} />
        <KpiCard label={t("hr.dashboard.monthlyPayrollCost")} value={`${fmt(kpis.monthlyPayrollCost)} ${currency}`} />
        <KpiCard label={t("hr.dashboard.accruedLeaveTotal")} value={`${fmt(kpis.accruedLeaveTotalDays)} ${daysUnit}`} />
        <KpiCard label={t("hr.dashboard.eosAccrualTotal")} value={`${fmt(kpis.eosAccrualTotal)} ${currency}`} />
      </div>

      <AlertsPanel title={t("hr.dashboard.alertsTitle")} alerts={alerts} emptyText={t("hr.dashboard.alertsEmpty")} />

      <div className="charts-grid">
        <div className="panel chart-panel">
          <h3>{companyId ? t("hr.dashboard.byDepartment") : t("hr.dashboard.byCompany")}</h3>
          {headcount.length === 0 ? <p className="empty">{t("hr.dashboard.headcountEmpty")}</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={headcount} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {headcount.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                </Pie>
                <Tooltip {...chartTooltipStyle} formatter={(v) => `${v} ${employeeUnit}`} />
                <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel chart-panel">
          <h3>{t("hr.dashboard.payrollTrendTitle")}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={payrollTrend}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ${currency}`} />
              <Line type="monotone" dataKey="total" name={t("hr.dashboard.payrollTrendSeries")} stroke={CHART_PALETTE[0]} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel chart-panel">
          <h3>{t("hr.dashboard.byNationality")}</h3>
          {nationality.length === 0 ? <p className="empty">{t("hr.dashboard.nationalityEmpty")}</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={nationality} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {nationality.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                </Pie>
                <Tooltip {...chartTooltipStyle} formatter={(v) => `${v} ${employeeUnit}`} />
                <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <p className="empty" style={{ fontSize: 11.5 }}>{t("hr.dashboard.eosFootnote")}</p>
    </div>
  );
}
