import React, { useEffect, useState } from "react";
import { listItems, createItem, updateItem, deleteItem } from "../../api/items";
import { fmt2 } from "../../legacy/constants";

const emptyForm = () => ({ code: "", name: "", unit: "", category: "", costPrice: "", reorderLevel: "" });

export default function ItemsTab({ companyId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listItems(companyId).then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    try {
      const payload = { ...form, companyId, costPrice: Number(form.costPrice || 0), reorderLevel: form.reorderLevel || undefined };
      if (editingId) await updateItem(editingId, payload);
      else await createItem(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (i) => { setEditingId(i.id); setForm({ ...emptyForm(), ...i, costPrice: i.costPrice, reorderLevel: i.reorderLevel || "" }); };
  const remove = async (i) => {
    if (!window.confirm(`حذف الصنف "${i.name}"؟`)) return;
    try {
      await deleteItem(i.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل الصنف — {form.name}</div>}
        <div className="form-grid">
          <label>كود الصنف<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>اسم الصنف<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>الوحدة<input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="لتر، قطعة..." /></label>
          <label>التصنيف<input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label>سعر التكلفة<input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></label>
          <label>حد إعادة الطلب<input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>إلغاء</button>}
          <button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ الصنف"}</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الكود</th><th>الاسم</th><th>الوحدة</th><th>سعر التكلفة</th><th></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.code}</td><td>{i.name}</td><td>{i.unit || "—"}</td><td className="num">{fmt2(i.costPrice)}</td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(i)}>تعديل</button>
                    <button className="btn-ghost" onClick={() => remove(i)}>حذف</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد أصناف بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
