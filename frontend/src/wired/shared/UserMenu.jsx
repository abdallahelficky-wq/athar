import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import IndependentAccountPicker from "./IndependentAccountPicker";
import { buildWhatsAppLink } from "../../lib/whatsapp";
import "../../styles/whatsapp.css";

/** قائمة منسدلة صغيرة عند اسم المستخدم بالهيدر العلوي: الملف الشخصي + تسجيل الخروج. */
export default function UserMenu({ name, email, companyName, tenantCode, onOpenProfile, onLogout }) {
  const { t } = useTranslation();
  const supportMessage = [
    t("whatsapp.msgSupport"),
    companyName ? t("whatsapp.msgSupportCompany", { company: companyName }) : null,
    tenantCode ? t("whatsapp.msgSupportCode", { code: tenantCode }) : null,
  ].filter(Boolean).join(" — ");
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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
    <div className="user-menu" ref={rootRef}>
      <button type="button" className="user-menu-trigger" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="user-menu-avatar">{(name || "؟").trim().charAt(0)}</span>
        <span className="user-menu-name">{name}</span>
        <span className={"user-menu-caret" + (open ? " open" : "")}>▾</span>
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-header-name">{name}</div>
            {email && <div className="user-menu-header-email">{email}</div>}
          </div>
          {onOpenProfile && (
            <button type="button" className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); onOpenProfile(); }}>
              الملف الشخصي
            </button>
          )}
          <IndependentAccountPicker />
          <a className="user-menu-item user-menu-item-link" role="menuitem" href={buildWhatsAppLink(supportMessage)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            {t("whatsapp.supportMenu")}
          </a>
          <button type="button" className="user-menu-item user-menu-item-danger" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>
            تسجيل الخروج
          </button>
        </div>
      )}
    </div>
  );
}
