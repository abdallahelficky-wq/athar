import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { sendInvoiceEmail } from "../../api/salesInvoices";

/** يظهر فقط لو الفاتورة ليس لعميلها بريد مسجَّل — يسمح بإدخال بريد بديل لمرة واحدة لإرسال نسخة الفاتورة إليه. */
export default function SendInvoiceEmailModal({ invoice, onClose, onSent }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!email.trim()) { setError(t("sales.sendInvoiceEmailModal.errRequired")); return; }
    setSaving(true);
    setError("");
    try {
      const result = await sendInvoiceEmail(invoice.id, email.trim());
      if (result.sent) onSent(t("sales.sendInvoiceEmailModal.sentMsg", { number: invoice.invoiceNumber, email: email.trim() }));
      else setError(t("sales.sendInvoiceEmailModal.errFailed"));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="unpost-confirm-box">
        <div className="modal-title-row">
          <h3>{t("sales.sendInvoiceEmailModal.title", { number: invoice.invoiceNumber })}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("sales.sendInvoiceEmailModal.close")}>×</button>
        </div>
        <p className="note">{t("sales.sendInvoiceEmailModal.note")}</p>
        <div className="form-grid">
          <label>{t("sales.sendInvoiceEmailModal.email")}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("sales.sendInvoiceEmailModal.cancel")}</button>
          <button className="btn-primary" onClick={send} disabled={saving}>{saving ? t("sales.sendInvoiceEmailModal.sending") : t("sales.sendInvoiceEmailModal.send")}</button>
        </div>
      </div>
    </div>
  );
}
