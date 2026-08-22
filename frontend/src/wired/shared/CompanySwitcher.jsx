import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCompanyColor, getCompanyInitials } from "./CompanyCards";
import { countryName, currencyLabel } from "../../shared/countries";

/**
 * مبدّل الشركة النشطة — صندوق مصغّر أعلى الشريط الجانبي (بيانات حقيقية من نفس real.companies/
 * real.companyId المستخدَمة في كل مكان بالتطبيق، بلا أي API جديد)، يفتح قائمة منسدلة لتبديل
 * الشركة النشطة فوراً من أي صفحة — بخلاف الزر القديم في الهيدر العلوي (topbar-active-company) الذي
 * كان يتطلّب الرجوع للوحة القيادة أولاً لتغيير الشركة من شبكة البطاقات هناك. شبكة بطاقات الشركات
 * في لوحة القيادة (CompanyCards.jsx) تبقى كما هي بلا أي تعديل — هذا مكوّن إضافي منفصل تماماً
 * لتبديل سريع من أي مكان، وليس بديلاً عنها.
 */
export default function CompanySwitcher({ companies, companyId, setCompanyId, onViewAll }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const active = companies.find((c) => c.id === companyId);

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

  if (companies.length === 0) return null;

  return (
    <div className="sidebar-company" ref={rootRef}>
      <button
        type="button" className="sidebar-company-trigger" onClick={() => setOpen((v) => !v)}
        title={t("nav.activeCompanyTitle")} aria-haspopup="menu" aria-expanded={open}
      >
        {active?.logoUrl ? (
          <img src={active.logoUrl} alt={active.name} className="sidebar-company-logo" />
        ) : (
          <span className="sidebar-company-avatar" style={{ background: getCompanyColor(active?.id || "") }}>
            {active ? getCompanyInitials(active) : "؟"}
          </span>
        )}
        <span className="sidebar-company-info">
          <span className="sidebar-company-name">{active?.shortName || active?.name || t("nav.noCompanySelected")}</span>
          <span className="sidebar-company-meta">
            {active ? `${countryName(active.country, i18n.language)} · ${currencyLabel(active.currency, i18n.language)}` : t("nav.activeCompanyLabel")}
          </span>
        </span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className={"sidebar-company-caret" + (open ? " open" : "")}>
          <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="sidebar-company-dropdown" role="menu">
          {companies.map((c) => (
            <button
              key={c.id} type="button" role="menuitem"
              className={"sidebar-company-option" + (c.id === companyId ? " active" : "")}
              onClick={() => { setCompanyId(c.id); setOpen(false); }}
            >
              {c.logoUrl ? (
                <img src={c.logoUrl} alt={c.name} className="sidebar-company-option-logo" />
              ) : (
                <span className="sidebar-company-option-avatar" style={{ background: getCompanyColor(c.id) }}>{getCompanyInitials(c)}</span>
              )}
              <span className="sidebar-company-option-name">{c.shortName || c.name}</span>
              {c.id === companyId && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="sidebar-company-option-check">
                  <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          <button type="button" className="sidebar-company-manage" onClick={() => { setOpen(false); onViewAll(); }}>
            {t("nav.viewAllCompanies")}
          </button>
        </div>
      )}
    </div>
  );
}
