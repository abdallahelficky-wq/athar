import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { routes } from "../../routes";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/**
 * أيقونة الإشعارات بالهيدر العلوي — بيانات حقيقية بالكامل، بلا أي API جديد: نفس عددَي التنبيهات
 * المحسوبَين أصلاً في App.jsx للشارات على "المبيعات"/"شئون الموظفين" بالقائمة الجانبية
 * (getFinancialAlerts/getHrAlerts)، معروضين هنا كقائمة منسدلة بدل رقم صغير فقط.
 */
export default function NotificationBell({ overdueInvoicesCount, pendingLeaveCount }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const total = overdueInvoicesCount + pendingLeaveCount;

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="notif-bell" ref={rootRef}>
      <button
        type="button" className="notif-bell-btn" onClick={() => setOpen((v) => !v)}
        title={t("nav.notifications.title")} aria-haspopup="menu" aria-expanded={open}
      >
        <BellIcon />
        {total > 0 && <span className="notif-dot" />}
      </button>
      {open && (
        <div className="notif-dropdown" role="menu">
          <div className="notif-dropdown-title">{t("nav.notifications.title")}</div>
          {total === 0 ? (
            <p className="notif-empty">{t("nav.notifications.empty")}</p>
          ) : (
            <>
              {overdueInvoicesCount > 0 && (
                <Link to={routes.sales()} className="notif-item" role="menuitem" onClick={() => setOpen(false)}>
                  {t("nav.notifications.overdueInvoices", { count: overdueInvoicesCount })}
                </Link>
              )}
              {pendingLeaveCount > 0 && (
                <Link to={routes.hr()} className="notif-item" role="menuitem" onClick={() => setOpen(false)}>
                  {t("nav.notifications.pendingLeaves", { count: pendingLeaveCount })}
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
