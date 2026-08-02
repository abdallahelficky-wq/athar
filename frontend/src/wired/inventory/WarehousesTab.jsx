import React, { useEffect, useState } from "react";
import { listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from "../../api/warehouses";

const emptyForm = () => ({ name: "", code: "", location: "", isDefault: false });

export default function WarehousesTab({ companyId }) {
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    listWarehouses(companyId).then(setWarehouses).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = { ...form, companyId, code: form.code || undefined, location: form.location || undefined };
      if (editingId) await updateWarehouse(editingId, payload);
      else await createWarehouse(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) { setError(err.message); }
  };

  const startEdit = (w) => {
    setEditingId(w.id);
    setForm({ name: w.name, code: w.code || "", location: w.location || "", isDefault: w.isDefault });
  };

  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const remove = async (w) => {
    if (!window.confirm(`حذف المستودع "${w.name}"؟`)) return;
    try { await deleteWarehouse(w.id); reload(); } catch (err) { setError(err.message); }
  };

  const toggleArchive = async (w) => {
    try { await updateWarehouse(w.id, { isArchived: !w.isArchived }); reload(); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>اسم المستودع<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>كود المستودع<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>الموقع<input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> المستودع الافتراضي لصرف المبيعات</label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={cancelEdit}>إلغاء</button>}
          <button className="btn-primary" onClick={save} disabled={!form.name.trim()}>{editingId ? "حفظ التعديلات" : "إضافة مستودع"}</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>اسم المستودع</th><th>الكود</th><th>الموقع</th><th>الافتراضي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {warehouses.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td><td>{w.code || "—"}</td><td>{w.location || "—"}</td>
                  <td>{w.isDefault ? "✓" : "—"}</td>
                  <td><span className={`archive-status ${w.isArchived ? "archived" : ""}`}><i />{w.isArchived ? "مؤرشف" : "نشط"}</span></td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(w)}>تعديل</button>
                    <button className="btn-ghost" onClick={() => toggleArchive(w)}>{w.isArchived ? "إلغاء الأرشفة" : "أرشفة"}</button>
                    <button className="btn-ghost" onClick={() => remove(w)}>حذف</button>
                  </td>
                </tr>
              ))}
              {warehouses.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد مستودعات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
