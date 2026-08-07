import React, { useState } from "react";
import { createCustomer } from "../../api/customers";

/** نافذة فرعية (nested modal) لإضافة عميل جديد بسرعة من داخل نافذة فاتورة المبيعات */
export default function NewCustomerModal({ companyId, initialName, onClose, onCreated }) {
  const [name, setName] = useState(initialName || "");
  const [vatNumber, setVatNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) { setError("اسم العميل مطلوب"); return; }
    setSaving(true);
    setError("");
    try {
      const customer = await createCustomer({
        companyId, name: name.trim(), customerType: vatNumber ? "business" : "individual",
        vatNumber: vatNumber || undefined, phone: phone || undefined, email: email || undefined,
      });
      onCreated(customer);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay">
      <div className="unpost-confirm-box">
        <h3>إضافة عميل جديد</h3>
        <div className="form-grid">
          <label>اسم العميل<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label>الرقم الضريبي (اختياري)<input type="text" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} /></label>
          <label>رقم الهاتف (اختياري)<input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>البريد الإلكتروني (اختياري)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ العميل"}</button>
        </div>
      </div>
    </div>
  );
}
