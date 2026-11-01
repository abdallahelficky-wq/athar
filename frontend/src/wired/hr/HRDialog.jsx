import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./hrDialogs.css";

export default function HRDialog({ title, children, onClose }) {
  const { t } = useTranslation();
  const ref = useRef(null), titleId = useId();
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  const keys = e => {
    if (!ref.current.contains(e.target) || e.target.closest(".unpost-confirm-overlay")) return;
    if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); close.current(); }
    if (e.key !== "Tab") return;
    const nodes = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(n => n.getClientRects().length);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return createPortal(<div className="hr-dialog-overlay"><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="hr-dialog" onKeyDown={keys}>
    <header className="hr-dialog-header"><h2 id={titleId}>{title}</h2><button className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>×</button></header>
    <div className="hr-dialog-body">{children}</div>
  </section></div>, document.body);
}
