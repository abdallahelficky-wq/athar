import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { sendSalesReturnEmail } from "../../api/salesReturns";

/** يظهر فقط لو الإشعار ليس لعميله بريد مسجَّل — نفس SendInvoiceEmailModal.jsx بالضبط (راجعه)،
 * لكن بنصوص خاصة بإشعار الدائن (sales.returns.sendEmailModal.*) لا الفاتورة. */
export default function SendCreditNoteEmailModal({ salesReturn, onClose, onSent }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!email.trim()) { setError(t("sales.returns.sendEmailModal.errRequired")); return; }
    setSaving(true);
    setError("");
    try {
      const result = await sendSalesReturnEmail(salesReturn.id, email.trim());
      if (result.sent) onSent(t("sales.returns.notify.emailSent", { number: salesReturn.returnNumber, email: email.trim() }));
      else setError(t("sales.returns.sendEmailModal.errFailed"));
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
          <h3>{t("sales.returns.sendEmailModal.title", { number: salesReturn.returnNumber })}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("sales.returns.sendEmailModal.close")}>×</button>
        </div>
        <p className="note">{t("sales.returns.sendEmailModal.note")}</p>
        <div className="form-grid">
          <label>{t("sales.returns.sendEmailModal.email")}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("sales.returns.sendEmailModal.cancel")}</button>
          <button className="btn-primary" onClick={send} disabled={saving}>{saving ? t("sales.returns.sendEmailModal.sending") : t("sales.returns.sendEmailModal.send")}</button>
        </div>
      </div>
    </div>
  );
}
