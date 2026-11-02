import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * نافذة منبثقة موحّدة لنماذج الإضافة/التعديل فوق القوائم (المستودعات، الإدخال/الإخراج، الصرف، التحويل، التسوية...).
 * تُغلَق بزر × أو Esc أو النقر خارجها؛ تتمرّر داخلها إن طال النموذج. المحتوى (الحقول والأزرار) يبقى في الشاشة نفسها.
 */
const DIALOG_STYLE = { maxWidth: 1000, width: "95vw", maxHeight: "90vh", overflowY: "auto", margin: 0 };

export default function FormDialog({ open, title, onClose, children, style }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel form-panel" role="dialog" aria-modal="true" style={{ ...DIALOG_STYLE, ...style }}>
        <div className="modal-title-row">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
