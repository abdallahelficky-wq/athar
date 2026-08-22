import React from "react";
import { useTranslation } from "react-i18next";
import { fmt } from "../../legacy/constants";

function ArrowIcon({ direction }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {direction === "in" ? <polyline points="6 15 12 9 18 15" /> : <polyline points="6 9 12 15 18 9" />}
    </svg>
  );
}

/**
 * قائمة "أحدث الحركات" — تُعيد استخدام نفس بيانات أعلى حركات الكاش المحمَّلة أصلاً في
 * FinancialDashboard (topTransactions، بلا أي استدعاء API إضافي) بعرض بصري مختلف (Feed بأيقونة
 * Avatar ملوَّنة وحالة بدل جدول تقليدي) — كل عنصر بلونين فقط بحسب اتجاه الحركة (وارد/صادر).
 */
export default function RecentActivity({ items, currency }) {
  const { t } = useTranslation();

  if (items.length === 0) return <p className="empty">{t("dashboard.topTransactions.empty")}</p>;

  return (
    <ul className="recent-activity-list">
      {items.map((tr, i) => (
        <li key={i} className="recent-activity-item">
          <div className={"recent-activity-avatar recent-activity-avatar-" + tr.direction}>
            <ArrowIcon direction={tr.direction} />
          </div>
          <div className="recent-activity-body">
            <div className="recent-activity-title">{tr.memo || tr.accountName}</div>
            <div className="recent-activity-meta">{tr.accountName} — {tr.date.slice(0, 10)}</div>
          </div>
          <div className="recent-activity-amount">
            <div className="recent-activity-value">{fmt(Math.abs(tr.amount))} {currency}</div>
            <span className={"recent-activity-status recent-activity-status-" + tr.direction}>
              {tr.direction === "in" ? t("dashboard.charts.cashIn") : t("dashboard.charts.cashOut")}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
