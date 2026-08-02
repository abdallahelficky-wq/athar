import React, { useEffect, useRef, useState } from "react";

/** قائمة منسدلة صغيرة عند اسم المستخدم بالهيدر العلوي: الملف الشخصي + تسجيل الخروج. */
export default function UserMenu({ name, email, onOpenProfile, onLogout }) {
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
          <button type="button" className="user-menu-item user-menu-item-danger" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>
            تسجيل الخروج
          </button>
        </div>
      )}
    </div>
  );
}
