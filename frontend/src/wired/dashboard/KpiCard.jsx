import React from "react";

/** بطاقة مؤشر سريع (KPI) — changePct اختياري لعرض نسبة تغيّر ملوّنة (أخضر/أحمر) */
export default function KpiCard({ label, value, changePct, changeLabel, tone }) {
  const changeColorClass = changePct == null ? "" : changePct >= 0 ? "balance-ok" : "balance-bad";
  return (
    <div className={"panel kpi-card" + (tone ? ` kpi-card-${tone}` : "")}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {changePct != null && (
        <div className={"kpi-change " + changeColorClass}>
          {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}% {changeLabel || ""}
        </div>
      )}
    </div>
  );
}
