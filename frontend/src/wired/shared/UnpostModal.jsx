import React, { useState } from "react";

/** نافذة فك الترحيل المشتركة — تتحقق من الرقم السري فعلياً عبر الخادم.
 * warningText اختياري: تحذير إضافي أوضح يُعرض فوق حقل الرقم السري (مثلاً لتوضيح أن الإجراء
 * استثنائي ويُسجَّل في سجل التدقيق) — لا يغيّر سلوك الاستخدامات الحالية التي لا تمرّره. */
export default function UnpostModal({ onConfirm, onCancel, title = "فك الترحيل", warningText }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(pin);
    } catch (err) {
      setError(err.message || "الرقم السري غير صحيح");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && !submitting && onCancel()}>
      <div className="unpost-confirm-box">
        <div className="modal-title-row">
          <h3>{title}</h3>
          <button type="button" className="modal-close-btn" onClick={onCancel} disabled={submitting} aria-label="إغلاق">×</button>
        </div>
        {warningText && <p className="unpost-strong-warning">{warningText}</p>}
        <p className="note">أدخل الرقم السري لتأكيد فك الترحيل. سيتحقق الخادم من صحته فعلياً.</p>
        <input
          type="password"
          placeholder="الرقم السري"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onCancel} disabled={submitting}>إلغاء</button>
          <button className="btn-primary" onClick={submit} disabled={submitting || !pin}>
            {submitting ? "جارٍ التحقق..." : "تأكيد فك الترحيل"}
          </button>
        </div>
      </div>
    </div>
  );
}
