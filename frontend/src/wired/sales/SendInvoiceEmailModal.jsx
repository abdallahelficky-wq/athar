import React, { useState } from "react";
import { sendInvoiceEmail } from "../../api/salesInvoices";

/** يظهر فقط لو الفاتورة ليس لعميلها بريد مسجَّل — يسمح بإدخال بريد بديل لمرة واحدة لإرسال نسخة الفاتورة إليه. */
export default function SendInvoiceEmailModal({ invoice, onClose, onSent }) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!email.trim()) { setError("البريد الإلكتروني مطلوب"); return; }
    setSaving(true);
    setError("");
    try {
      const result = await sendInvoiceEmail(invoice.id, email.trim());
      if (result.sent) onSent(`تم إرسال الفاتورة ${invoice.invoiceNumber} إلى ${email.trim()}.`);
      else setError("تعذّر إرسال الفاتورة — حاول مرة أخرى لاحقاً.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay">
      <div className="unpost-confirm-box">
        <h3>إرسال الفاتورة {invoice.invoiceNumber} بالإيميل</h3>
        <p className="note">لا يوجد بريد إلكتروني مسجَّل لهذا العميل — أدخل بريداً بديلاً لإرسال نسخة الفاتورة إليه لمرة واحدة.</p>
        <div className="form-grid">
          <label>البريد الإلكتروني<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-primary" onClick={send} disabled={saving}>{saving ? "جارٍ الإرسال..." : "إرسال"}</button>
        </div>
      </div>
    </div>
  );
}
