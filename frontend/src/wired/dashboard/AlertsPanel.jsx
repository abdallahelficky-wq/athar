import React from "react";

/**
 * ودجت "أهم التنبيهات" — مُستخدَم في كل من الداشبورد المالية وداشبورد شئون الموظفين.
 * alerts: [{ title, detail, days }] مرتّبة مسبقاً من الأقرب أجلاً (days أصغر = أعجل)،
 * بحيث "منتهي/متأخر بالفعل" (days سالب) يُبرَز بلون التحذير الأحمر (alert-expired).
 */
export default function AlertsPanel({ title, alerts, emptyText }) {
  return (
    <div className="alerts-panel">
      <div className="alerts-head">{title}</div>
      {alerts.length === 0 ? (
        <p className="empty" style={{ margin: 0 }}>{emptyText}</p>
      ) : (
        <div className="alerts-grid">
          {alerts.map((a, i) => (
            <div key={i} className={"alert-chip" + (a.days != null && a.days < 0 ? " alert-expired" : "")}>
              <strong>{a.title}</strong>
              <span>{a.detail}</span>
              {a.companyName && <span className="alert-days">{a.companyName}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
