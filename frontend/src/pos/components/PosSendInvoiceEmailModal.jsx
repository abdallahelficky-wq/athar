import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { sendInvoiceEmail } from "../../api/salesInvoices";

/**
 * حوار إرسال فاتورة نقطة البيع بالإيميل — يظهر فقط عند عدم وجود بريد مسجَّل للعميل (راجع
 * PosInvoiceViewModal.sendEmail)، مع تعبئة الحقل تلقائياً من سجل العميل إن وُجد (prefillEmail)
 * وإتاحة تعديله قبل الإرسال، تماماً كما طُلِب في الميزة.
 */
export default function PosSendInvoiceEmailModal({ invoiceId, invoiceNumber, prefillEmail, onClose, onSent }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(prefillEmail || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!email.trim()) { setError(t("pos.sendEmailModal.errRequired")); return; }
    setSaving(true);
    setError("");
    try {
      const result = await sendInvoiceEmail(invoiceId, email.trim());
      if (result.sent) onSent(t("pos.sendEmailModal.sentMsg", { number: invoiceNumber, email: email.trim() }));
      else setError(t("pos.sendEmailModal.errFailed"));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pos-modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="pos-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="pos-modal-header">
          <span>{t("pos.sendEmailModal.title", { number: invoiceNumber })}</span>
          <button className="pos-icon-btn" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <label className="m-field">
          {t("pos.sendEmailModal.email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>

        {error && <p className="m-error">{error}</p>}

        <div className="pos-modal-actions">
          <button className="pos-big-btn" disabled={saving} onClick={send}>
            {saving ? t("pos.sendEmailModal.sending") : t("pos.sendEmailModal.send")}
          </button>
          <button className="m-btn secondary" onClick={onClose} disabled={saving}>{t("pos.sendEmailModal.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
