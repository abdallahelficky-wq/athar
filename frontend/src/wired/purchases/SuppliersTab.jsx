import React, { useEffect, useState } from "react";
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from "../../api/suppliers";

const emptyForm = () => ({ name: "", vatNumber: "", crNumber: "", phone: "", email: "", city: "", paymentTerms: "آجل 30 يوم" });

export default function SuppliersTab({ companyId }) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listSuppliers(companyId).then(setSuppliers).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = { ...form, companyId };
      if (editingId) await updateSupplier(editingId, payload);
      else await createSupplier(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (s) => { setEditingId(s.id); setForm({ ...emptyForm(), ...s }); };
  const remove = async (s) => {
    if (!window.confirm(`حذف المورد "${s.name}"؟`)) return;
    try {
      await deleteSupplier(s.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل المورد — {form.name}</div>}
        <div className="form-grid">
          <label>اسم المورد<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>الرقم الضريبي<input type="text" value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} /></label>
          <label>السجل التجاري<input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></label>
          <label>الجوال<input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>المدينة<input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>شروط الدفع
            <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
              <option>نقدي</option><option>آجل 30 يوم</option><option>آجل 60 يوم</option><option>آجل 90 يوم</option>
            </select>
          </label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>إلغاء</button>}
          <button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ بيانات المورد"}</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الاسم</th><th>الرقم الضريبي</th><th>المدينة</th><th>شروط الدفع</th><th></th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td><td>{s.vatNumber || "—"}</td><td>{s.city || "—"}</td><td>{s.paymentTerms || "—"}</td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(s)}>تعديل</button>
                    <button className="btn-ghost" onClick={() => remove(s)}>حذف</button>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && <tr><td className="empty" colSpan={5}>لا يوجد موردون بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
