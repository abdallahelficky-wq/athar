import React from "react";
import { useTranslation } from "react-i18next";
import "../../styles/lease-screen.css";
import "../../styles/sales-screen.css";

/* هيكل شاشات المبيعات الموحَّد (نفس بناء شاشة الإيجارات بلوحة ألوان المبيعات الزرقاء — sales-screen.css):
 * رأس ملوَّن بعنوان وأزرار وفلاتر سريعة، مؤشرات، صندوق بحث، وشارات حالة. كل تبويب يمرّر محتواه كـchildren. */
const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
const ICONS = {
  invoices: <><path d="M6 2h9l4 4v16l-3-2-2.5 2-2.5-2-2.5 2L6 22z" /><path d="M15 2v4h4" /><path d="M9 11h6M9 15h4" /></>,
  customers: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.5a5 5 0 0 1 4.5 5.5" /></>,
  quotations: <><path d="M6 2h9l4 4v16H6z" /><path d="M15 2v4h4" /><path d="M9 12h6M9 16h6M9 8h2" /></>,
  returns: <><path d="M4 9h11a5 5 0 0 1 0 10H8" /><path d="M8 5L4 9l4 4" /></>,
  receipts: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /><path d="M6 15h4" /></>,
  stations: <><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" /><path d="M3 21h12" /><path d="M7 7h4v4H7z" /><path d="M14 9h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8l-2.5-2.5" /></>,
  reports: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
};

export function SalesScreen({ icon, title, note, actions, chips, children }) {
  return (
    <div className="lease-screen sales-screen">
      <div className="ls-hero">
        <div className="ls-hero-top">
          <div className="ls-hero-main">
            <div className="ls-hero-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" {...p}>{ICONS[icon]}</svg></div>
            <div><h3>{title}</h3>{note && <p>{note}</p>}</div>
          </div>
          {actions && <div className="ls-hero-actions">{actions}</div>}
        </div>
        {chips && <div className="ls-chips">{chips}</div>}
      </div>
      {children}
    </div>
  );
}

export function HeroButton({ children, ...rest }) {
  return <button type="button" className="ls-btn ls-btn-accent" {...rest}>{children}</button>;
}

// tone: ok (أخضر) | wait (كهرماني) | bad (أحمر) — أو بلا لون لزر «الكل»
const CHIP_TONE = { ok: "st-active", wait: "st-suspended", bad: "st-stopped" };
export function SalesChip({ on, tone, onClick, children }) {
  return (
    <button type="button" className={`ls-chip${tone ? ` ss-chip ${CHIP_TONE[tone]}` : ""}${on ? " is-on" : ""}`} onClick={onClick}>
      {tone && <i aria-hidden="true" />}{children}
    </button>
  );
}
export function SalesInfoChip({ count, label }) {
  return <span className="ls-chip ls-chip-info"><b>{count}</b>{label}</span>;
}

/** items: [{ label, value, tone }] — tone: gray | blue (الافتراضي) | amber | green | red | teal */
export function SalesKpis({ items, loading }) {
  return (
    <div className={`ls-kpis${loading ? " is-loading" : ""}`}>
      {items.map((k) => (
        <div key={k.label} className={`ls-kpi${k.tone && k.tone !== "blue" ? ` tone-${k.tone}` : ""}`}>
          <div className="ls-kpi-label">{k.label}</div><div className="ls-kpi-value">{k.value}</div>
        </div>
      ))}
    </div>
  );
}

/** صندوق البحث السريع؛ children = البحث المتقدم (يظهر عند advanced.open). advanced و onReset اختياريان. */
export function SalesSearch({ value, onChange, placeholder, label, advanced, onReset, showReset, extra, children }) {
  const { t } = useTranslation();
  return (
    <div className="panel ss-search">
      <div className="ss-search-row">
        <div className="ss-search-box">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} />
        </div>
        {advanced && (
          <button type="button" className={`ls-act${advanced.open ? " is-primary" : ""}`} aria-expanded={advanced.open} onClick={advanced.onToggle}>
            {t("salesInvoices.screen.advanced")}{advanced.count > 0 && <b className="ss-count">{advanced.count}</b>}
          </button>
        )}
        {showReset && onReset && <button type="button" className="ls-act" onClick={onReset}>{t("filters.reset")}</button>}
        {extra}
      </div>
      {advanced?.open && children}
    </div>
  );
}

const BADGE_TONE = { ok: "pay-paid", wait: "pay-due", bad: "pay-overdue", off: "pay-hold" };
export function StatusBadge({ tone = "off", children }) {
  return <span className={`ls-badge ${BADGE_TONE[tone] || BADGE_TONE.off}`}>{children}</span>;
}
