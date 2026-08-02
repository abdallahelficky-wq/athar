import React, { useState } from "react";
import { createItem } from "../../api/items";

/** نافذة فرعية لإضافة صنف قابل للبيع بسرعة من داخل سطر فاتورة المبيعات — تُنشئ صنفاً حقيقياً من نوع "خدمة" بحساب إيراد واحد، وهو أبسط الأنواع القابلة للبيع؛ لضبط بيانات أكثر تفصيلاً (مخزون، مادة أولية...) استخدم شاشة "الأصناف والمنتجات" مباشرة. */
export default function NewSellableItemModal({ companyId, accounts, initialName, onClose, onCreated }) {
  const [name, setName] = useState(initialName || "");
  const [salePrice, setSalePrice] = useState("");
  const [vatApplicable, setVatApplicable] = useState(true);
  const [revenueAccountId, setRevenueAccountId] = useState(accounts[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim() || !revenueAccountId) { setError("اسم الصنف والحساب المرتبط مطلوبان"); return; }
    setSaving(true);
    setError("");
    try {
      const item = await createItem({
        companyId, name: name.trim(), code: `SVC-${Date.now()}`, type: "service",
        salePrice: Number(salePrice || 0), vatApplicable, revenueAccountId,
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
        <h3>إضافة صنف جديد (خدمة)</h3>
        <div className="form-grid">
          <label>اسم الصنف<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label>سعر البيع الافتراضي<input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0.00" /></label>
          <label>الحساب المرتبط (إيراد)
            <select value={revenueAccountId} onChange={(e) => setRevenueAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={vatApplicable} onChange={(e) => setVatApplicable(e.target.checked)} />
            خاضع لضريبة القيمة المضافة
          </label>
        </div>
        <p className="note">لضبط صنف مخزوني أو أصل ثابت أو مادة أولية، استخدم شاشة "الأصناف والمنتجات" مباشرة.</p>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الصنف"}</button>
        </div>
      </div>
    </div>
  );
}
