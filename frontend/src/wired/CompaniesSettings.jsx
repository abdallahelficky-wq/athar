import React, { useState } from "react";
import { createCompany, deleteCompany } from "../api/companies";
import { useAuth } from "../context/AuthContext";
import CompanyEditModal from "./CompanyEditModal";
import CompanyZatcaModal from "./CompanyZatcaModal";

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

// نشاط المنشأة — يحدد قالب شجرة الحسابات والأصناف الابتدائية التي تُزرَع تلقائياً عند الإنشاء.
// اختياري: تركه فارغاً يزرع القالب العام الافتراضي بدل قالب قطاعي.
const BUSINESS_ACTIVITY_OPTIONS = [
  { value: "", label: "بدون تحديد (قالب عام)" },
  { value: "contracting", label: "مقاولات" },
  { value: "manufacturing", label: "مصانع / تصنيع" },
  { value: "retail", label: "مبيعات تجزئة" },
  { value: "general_trade", label: "أنشطة تجارية عامة (تجارة واستيراد وتصدير)" },
  { value: "fuel_stations", label: "محطات وقود" },
];

/** إنشاء شركة جديدة — المكان الوحيد في النظام لإضافة شركة (لم يعد متاحاً من أي شاشة معاملات) */
function NewCompanyForm({ onCompanyCreated }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [businessActivity, setBusinessActivity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim()) { setError("اسم الشركة مطلوب"); return; }
    setSaving(true);
    setError("");
    try {
      const company = await createCompany({
        name: name.trim(),
        shortName: shortName.trim() || undefined,
        businessActivity: businessActivity || undefined,
      });
      setName("");
      setShortName("");
      setBusinessActivity("");
      setShowForm(false);
      onCompanyCreated?.(company);
    } catch (err) {
      setError(err.message || "تعذّر إنشاء الشركة");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel form-panel">
      <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>بيانات الشركات (حقيقية)</h3>
        <button type="button" className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "إلغاء" : "+ شركة جديدة"}
        </button>
      </div>
      {showForm && (
        <div className="form-grid" style={{ marginTop: 14 }}>
          <label>اسم الشركة<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: تيسم برو" /></label>
          <label>الاسم المختصر (اختياري)<input type="text" value={shortName} onChange={(e) => setShortName(e.target.value)} /></label>
          <label>
            نشاط المنشأة
            <select value={businessActivity} onChange={(e) => setBusinessActivity(e.target.value)}>
              {BUSINESS_ACTIVITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? "جارٍ الحفظ..." : "إنشاء الشركة"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}

/** إدارة كاملة (إنشاء/تعديل/حذف) للشركات الحقيقية — يُستخدم داخل تبويب "بيانات الشركات" بالإعدادات،
 * وهو المكان الوحيد في النظام لإنشاء شركة جديدة بعد إزالة هذا الخيار من كل شاشات المعاملات */
export default function CompaniesSettings({ companies, reload, onCompanyCreated }) {
  const [editingCompany, setEditingCompany] = useState(null);
  const [zatcaCompany, setZatcaCompany] = useState(null);
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

  const handleCreated = (company) => {
    onCompanyCreated?.(company);
    reload();
  };

  return (
    <div>
      <TenantNameSettings />
      <NewCompanyForm onCompanyCreated={handleCreated} />
      <div className="panel form-panel">
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
                <button className="btn-ghost" onClick={() => setZatcaCompany(c)}>ربط فاتورة (ZATCA)</button>
                <button className="btn-ghost" onClick={() => remove(c)}>حذف</button>
              </td>
            </tr>
          ))}
          {companies.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد شركات بعد — استخدم زر "+ شركة جديدة" أعلاه لإضافة أول شركة.</td></tr>}
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

      {zatcaCompany && (
        <CompanyZatcaModal
          company={zatcaCompany}
          onClose={() => setZatcaCompany(null)}
        />
      )}
    </div>
  );
}
