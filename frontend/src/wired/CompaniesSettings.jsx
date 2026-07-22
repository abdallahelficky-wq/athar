import React, { useState } from "react";
import { updateCompany, deleteCompany } from "../api/companies";
import { useAuth } from "../context/AuthContext";

/** تعديل اسم المنشأة (المستأجر) — لا يوجد له مسار آخر بعد التسجيل الأول، وهو ضروري خصوصاً
 * لتصحيح اسم أُدخل بترميز خاطئ عند إنشاء الحساب لأول مرة (مثلاً عبر إدخال مباشر في قاعدة
 * البيانات بترميز غير UTF-8) — يظهر هذا الاسم في السطر العلوي وفي الشريط الجانبي. */
function TenantNameSettings() {
  const { tenant, renameTenant } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tenant?.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) { setError("اسم المنشأة مطلوب"); return; }
    setSaving(true);
    setError("");
    try {
      await renameTenant(name.trim());
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel form-panel">
      <h3>اسم المنشأة (يظهر في أعلى الشاشة والشريط الجانبي)</h3>
      {editing ? (
        <div className="form-grid" style={{ alignItems: "end" }}>
          <label>اسم المنشأة<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</button>
          </label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-ghost" onClick={() => { setEditing(false); setName(tenant?.name || ""); setError(""); }}>إلغاء</button>
          </label>
        </div>
      ) : (
        <div className="form-btn-group">
          <span className="status-badge">{tenant?.name}</span>
          <button className="btn-ghost" onClick={() => setEditing(true)}>تعديل الاسم</button>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}

/** إدارة كاملة (تعديل/حذف) للشركات الحقيقية — يُستخدم داخل تبويب "بيانات الشركات" بالإعدادات */
export default function CompaniesSettings({ companies, reload }) {
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      shortName: c.shortName || "",
      vatNumber: c.vatNumber || "",
      crNumber: c.crNumber || "",
      nationalAddress: c.nationalAddress || "",
    });
  };

  const save = async () => {
    try {
      await updateCompany(editingId, form);
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`حذف شركة "${c.name}"؟ لن يمكن حذفها إن كان لديها قيود مسجّلة.`)) return;
    try {
      await deleteCompany(c.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <TenantNameSettings />
      <div className="panel form-panel">
        <h3>بيانات الشركات (حقيقية)</h3>
        {error && <p className="balance-bad">{error}</p>}
      <table className="ledger-table">
        <thead><tr><th>الاسم</th><th>الاسم المختصر</th><th>الرقم الضريبي</th><th>السجل التجاري</th><th></th></tr></thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              {editingId === c.id ? (
                <>
                  <td><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></td>
                  <td><input type="text" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} /></td>
                  <td><input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value.replace(/\D/g, "") })} /></td>
                  <td><input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={save}>حفظ</button>
                    <button className="btn-ghost" onClick={() => setEditingId(null)}>إلغاء</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{c.name}</td>
                  <td>{c.shortName || "—"}</td>
                  <td>{c.vatNumber || "—"}</td>
                  <td>{c.crNumber || "—"}</td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(c)}>تعديل</button>
                    <button className="btn-ghost" onClick={() => remove(c)}>حذف</button>
                  </td>
                </>
              )}
            </tr>
          ))}
          {companies.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد شركات بعد — أنشئها من تبويب لوحة القيادة أو القيود اليومية.</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  );
}
