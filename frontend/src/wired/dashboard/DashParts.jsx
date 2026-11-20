import React, { useState } from "react";
import { useTranslation } from "react-i18next";

/* مكوّنات لوحة القيادة الجديدة (لغة تصميم شاشة الإيجارات/المبيعات — styles/dashboard-screen.css).
 * منفصلة عن KpiCard وAlertsPanel وPeriodFilter عمداً لأنها ما زالت تخدم لوحة شئون الموظفين بشكلها الحالي. */

export const compactNumber = (v) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** بطاقة داخل شبكة اللوحة؛ span = عدد الأعمدة من ١٢، tone = لون الشريط العلوي (green|red|amber|teal|gray) */
export function DashCard({ span = 6, tone, title, note, aside, className = "", children }) {
  return (
    <section className={`dash-card span-${span}${tone ? ` tone-${tone}` : ""}${className ? ` ${className}` : ""}`}>
      <header className="dash-card-head">
        <div><h4>{title}</h4>{note && <span>{note}</span>}</div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** رسم خطي صغير داخل بطاقة المؤشر — values: أرقام بالترتيب الزمني (يُهمَل إن قلّت عن نقطتين) */
export function Sparkline({ values }) {
  const pts = (values || []).filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const w = 120, h = 34, pad = 3;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const xy = pts.map((v, i) => [pad + (i * (w - pad * 2)) / (pts.length - 1), h - pad - ((v - min) / span) * (h - pad * 2)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${h} L${xy[0][0].toFixed(1)} ${h} Z`;
  return (
    <svg className="dash-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={area} fill="currentColor" opacity="0.14" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3" fill="currentColor" />
    </svg>
  );
}

/** مؤشر رئيسي — tone: blue|green|teal|amber|red؛ changePct اختياري (▲/▼ ملوَّن)؛ spark اختياري */
export function DashKpi({ tone = "blue", icon, label, value, currency, changePct, changeLabel, sub, spark }) {
  return (
    <div className={`ls-kpi dash-kpi${tone !== "blue" ? ` tone-${tone}` : ""}`}>
      <div className="dash-kpi-top">
        <span className="dash-kpi-ico" aria-hidden="true">{icon}</span>
        <span className="ls-kpi-label">{label}</span>
      </div>
      <div className="ls-kpi-value">{value}{currency && <small className="dash-cur">{currency}</small>}</div>
      <div className="dash-kpi-foot">
        {changePct != null && (
          <span className={`dash-delta ${changePct >= 0 ? "up" : "down"}`}>
            {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}%{changeLabel ? ` ${changeLabel}` : ""}
          </span>
        )}
        {sub && <span className="dash-sub">{sub}</span>}
        {spark}
      </div>
    </div>
  );
}

const ALERT_ROWS = 4;

function AlertGroup({ tone, title, items }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, ALERT_ROWS);
  return (
    <div className={`ls-alert${tone === "red" ? " tone-red" : ""}`}>
      <div className="ls-alert-head"><span className="ls-alert-count">{items.length}</span><strong>{title}</strong></div>
      {shown.map((a, i) => (
        <div key={i} className="ls-alert-row">
          <span className="ls-alert-title">{a.title}</span>
          <span className={`ls-pill${tone === "red" ? " is-bad" : ""}`}>{a.detail}</span>
          {a.companyName && <span className="ls-pill">{a.companyName}</span>}
        </div>
      ))}
      {items.length > ALERT_ROWS && (
        <button type="button" className="ls-act dash-alert-more" onClick={() => setAll((v) => !v)}>
          {all ? t("dashboard.screen.showLess") : t("dashboard.screen.showAll", { n: items.length })}
        </button>
      )}
    </div>
  );
}

/** alerts: [{ title, detail, days, companyName? }] — المتأخر/المنتهي (days < 0) في بطاقة حمراء، والقادم في كهرمانية */
export function DashAlerts({ alerts, emptyText }) {
  const { t } = useTranslation();
  if (alerts.length === 0) return <p className="ls-msg ls-msg-ok">{emptyText}</p>;
  const overdue = alerts.filter((a) => a.days != null && a.days < 0);
  const upcoming = alerts.filter((a) => !(a.days != null && a.days < 0));
  return (
    <div className="ls-alerts dash-alerts">
      <AlertGroup tone="red" title={t("dashboard.screen.alertsOverdue")} items={overdue} />
      <AlertGroup tone="amber" title={t("dashboard.screen.alertsUpcoming")} items={upcoming} />
    </div>
  );
}
