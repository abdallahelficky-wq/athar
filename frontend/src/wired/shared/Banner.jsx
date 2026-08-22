import React from "react";

const ICONS = {
  info: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <line x1="12" y1="10" x2="12" y2="14.5" />
      <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  danger: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12.5 10.8 15.3 16 9.3" />
    </svg>
  ),
};

/**
 * تنبيه علوي عام (Banner) — مكوّن مشترك قابل لإعادة الاستخدام في أي شاشة بالنظام، وليس مقصوراً
 * على الصفحة الرئيسية: يظهر أعلى المحتوى عند الحاجة (فاتورة متأخرة، ترخيص قارب على الانتهاء،
 * تنبيه معلوماتي...)، بأيقونة تناسب نوعه ورابط إجراء اختياري.
 *
 * type: "info" | "warning" | "danger" | "success" — يتحكم في لون الحد الجانبي والأيقونة فقط.
 * actionLabel/onAction اختياريان معاً — بدونهما يُعرَض التنبيه بلا زر إجراء.
 */
export default function Banner({ type = "info", title, message, actionLabel, onAction }) {
  return (
    <div className={`app-banner app-banner-${type}`}>
      <div className="app-banner-icon">{ICONS[type] || ICONS.info}</div>
      <div className="app-banner-body">
        {title && <div className="app-banner-title">{title}</div>}
        {message && <div className="app-banner-message">{message}</div>}
      </div>
      {actionLabel && onAction && (
        <button type="button" className="app-banner-action" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}
