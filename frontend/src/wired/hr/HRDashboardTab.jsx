import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { getHrKpis, getHrPayrollTrend, getHrHeadcount, getHrNationality, getHrAlerts } from "../../api/dashboard";
import { fmt } from "../../legacy/constants";
import KpiCard from "../dashboard/KpiCard";
import AlertsPanel from "../dashboard/AlertsPanel";
import { CHART_PALETTE, CHART_GRID, CHART_AXIS, CHART_FONT, chartTooltipStyle, colorAt } from "../dashboard/chartTheme";

const axisProps = { tick: { fontSize: 11.5, fill: CHART_AXIS, fontFamily: CHART_FONT }, axisLine: { stroke: CHART_GRID } };

/**
 * داشبورد شئون الموظفين — أول تبويب في قسم "شئون الموظفين"، نفس مبدأ الداشبورد المالية
 * (تحترم الشركة النشطة/عرض المجموعة كاملة عبر companyId فارغ = تجميع على مستوى المستأجر).
 */
export default function HRDashboardTab({ companyId }) {
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

  if (loading || !kpis) return <p className="empty">جارٍ التحميل...</p>;

  return (
    <div>
      <div className="kpi-row">
        <KpiCard label="عدد الموظفين النشطين" value={kpis.activeEmployeeCount} />
        <KpiCard label="تكلفة الرواتب الشهرية الحالية" value={`${fmt(kpis.monthlyPayrollCost)} ر.س`} />
        <KpiCard label="رصيد إجازة متراكم (كل الموظفين)" value={`${fmt(kpis.accruedLeaveTotalDays)} يوم`} />
        <KpiCard label="مخصص نهاية الخدمة المستحق" value={`${fmt(kpis.eosAccrualTotal)} ر.س`} />
      </div>

      <AlertsPanel title="⚠ تنبيهات شئون الموظفين" alerts={alerts} emptyText="لا توجد تنبيهات حالياً." />

      <div className="charts-grid">
        <div className="panel chart-panel">
          <h3>{companyId ? "توزيع الموظفين حسب الإدارة" : "توزيع الموظفين حسب الشركة"}</h3>
          {headcount.length === 0 ? <p className="empty">لا يوجد موظفون نشطون بعد.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={headcount} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {headcount.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                </Pie>
                <Tooltip {...chartTooltipStyle} formatter={(v) => `${v} موظف`} />
                <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel chart-panel">
          <h3>تطور تكلفة الرواتب (آخر ١٢ شهراً)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={payrollTrend}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...chartTooltipStyle} formatter={(v) => `${fmt(v)} ر.س`} />
              <Line type="monotone" dataKey="total" name="تكلفة الرواتب" stroke={CHART_PALETTE[0]} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel chart-panel">
          <h3>توزيع الموظفين حسب الجنسية</h3>
          {nationality.length === 0 ? <p className="empty">لا توجد بيانات جنسية مسجّلة بعد.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={nationality} dataKey="count" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {nationality.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                </Pie>
                <Tooltip {...chartTooltipStyle} formatter={(v) => `${v} موظف`} />
                <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: CHART_FONT }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <p className="empty" style={{ fontSize: 11.5 }}>
        * مخصص نهاية الخدمة تقدير مبني على افتراض إنهاء عادي من صاحب العمل اليوم لكل الموظفين النشطين (بدون خصم نسبة الاستقالة)، وليس تصفية فعلية.
      </p>
    </div>
  );
}
