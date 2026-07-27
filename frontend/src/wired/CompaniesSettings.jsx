import React, { useState } from "react";
import { deleteCompany } from "../api/companies";
import { useAuth } from "../context/AuthContext";
import CompanyEditModal from "./CompanyEditModal";

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
  const [editingCompany, setEditingCompany] = useState(null);
  const [error, setError] = useState("");

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
        <thead><tr><th>الاسم</th><th>الاسم التجاري</th><th>الرقم الضريبي</th><th>السجل التجاري</th><th></th></tr></thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.shortName || "—"}</td>
              <td>{c.vatNumber || "—"}</td>
              <td>{c.crNumber || "—"}</td>
              <td className="row-actions">
                <button className="btn-ghost" onClick={() => setEditingCompany(c)}>تعديل</button>
                <button className="btn-ghost" onClick={() => remove(c)}>حذف</button>
              </td>
            </tr>
          ))}
          {companies.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد شركات بعد — أنشئها من تبويب لوحة القيادة أو القيود اليومية.</td></tr>}
        </tbody>
      </table>
      </div>

      {editingCompany && (
        <CompanyEditModal
          company={editingCompany}
          onClose={() => setEditingCompany(null)}
          onSaved={() => { setEditingCompany(null); reload(); }}
        />
      )}
    </div>
  );
}
