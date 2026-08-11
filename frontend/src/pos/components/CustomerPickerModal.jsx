import React, { useEffect, useState } from "react";
import { listCustomers, createCustomer } from "../../api/customers";

export default function CustomerPickerModal({ companyId, onSelect, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { listCustomers(companyId).then(setCustomers).catch(() => setCustomers([])); }, [companyId]);

  const filtered = customers.filter((c) => !search.trim() || c.name.includes(search.trim()));

  const createAndSelect = async () => {
    if (!newName.trim()) { setError("اسم العميل مطلوب"); return; }
    setSaving(true);
    setError("");
    try {
      const created = await createCustomer({ companyId, name: newName.trim(), customerType: "individual", phone: newPhone || undefined });
      onSelect(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="pos-modal-header">
          <span>اختيار العميل</span>
          <button className="pos-icon-btn" onClick={onClose}>✕</button>
        </div>

        <button className="pos-list-row pos-cash-customer-row" onClick={() => onSelect(null)}>عميل نقدي (افتراضي)</button>

        {!showNewForm ? (
          <>
            <input className="pos-search-input" type="text" placeholder="ابحث عن عميل..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            <div className="pos-modal-list">
              {filtered.map((c) => (
                <button key={c.id} className="pos-list-row" onClick={() => onSelect(c)}>{c.name}</button>
              ))}
              {filtered.length === 0 && <p className="m-empty">لا يوجد عملاء بهذا الاسم</p>}
            </div>
            <button className="m-btn secondary" onClick={() => setShowNewForm(true)}>+ إضافة عميل جديد</button>
          </>
        ) : (
          <>
            <label className="m-field">اسم العميل<input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus /></label>
            <label className="m-field">جوال (اختياري)<input type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} /></label>
            {error && <p className="m-error">{error}</p>}
            <button className="pos-big-btn" disabled={saving} onClick={createAndSelect}>{saving ? "جارٍ الحفظ..." : "حفظ واختيار"}</button>
            <button className="m-btn secondary" onClick={() => setShowNewForm(false)}>رجوع للبحث</button>
          </>
        )}
      </div>
    </div>
  );
}
