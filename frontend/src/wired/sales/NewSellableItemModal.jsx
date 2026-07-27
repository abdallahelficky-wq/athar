import React, { useState } from "react";
import { createSellableItem } from "../../api/sellableItems";

/** نافذة فرعية لإضافة صنف/خدمة قابلة للبيع بسرعة من داخل سطر فاتورة المبيعات */
export default function NewSellableItemModal({ companyId, accounts, initialName, onClose, onCreated }) {
  const [name, setName] = useState(initialName || "");
  const [defaultUnitPrice, setDefaultUnitPrice] = useState("");
  const [vatApplicable, setVatApplicable] = useState(true);
  const [defaultRevenueAccountId, setDefaultRevenueAccountId] = useState(accounts[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim() || !defaultRevenueAccountId) { setError("اسم الصنف والحساب المرتبط مطلوبان"); return; }
    setSaving(true);
    setError("");
    try {
      const item = await createSellableItem({
        companyId, name: name.trim(), defaultUnitPrice: Number(defaultUnitPrice || 0),
        vatApplicable, defaultRevenueAccountId,
      });
      onCreated(item);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay">
      <div className="unpost-confirm-box">
        <h3>إضافة صنف جديد</h3>
        <div className="form-grid">
          <label>اسم الصنف<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label>سعر الوحدة الافتراضي<input type="number" value={defaultUnitPrice} onChange={(e) => setDefaultUnitPrice(e.target.value)} placeholder="0.00" /></label>
          <label>الحساب المرتبط (إيراد)
            <select value={defaultRevenueAccountId} onChange={(e) => setDefaultRevenueAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={vatApplicable} onChange={(e) => setVatApplicable(e.target.checked)} />
            خاضع لضريبة القيمة المضافة
          </label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الصنف"}</button>
        </div>
      </div>
    </div>
  );
}
