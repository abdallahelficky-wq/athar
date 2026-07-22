import React, { useState } from "react";
import { createCompany } from "../api/companies";

/**
 * منتقي "الشركة الحقيقية" — منفصل تماماً عن مبدّل الشركات المستخدَم في الموديولات
 * القديمة غير المرتبطة بعد بالـ API (المبيعات/المشتريات/المخزون/الأصول/الموظفين).
 * المستأجر الجديد يبدأ بدون أي شركة، لذا يعرض نموذج إنشاء أول شركة مباشرة.
 */
export default function CompanySelector({ companies, companyId, setCompanyId, onCompanyCreated }) {
  const [showForm, setShowForm] = useState(companies.length === 0);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim()) { setError("اسم الشركة مطلوب"); return; }
    setSaving(true);
    setError("");
    try {
      const company = await createCompany({ name: name.trim(), shortName: shortName.trim() || undefined });
      setName("");
      setShortName("");
      setShowForm(false);
      onCompanyCreated(company);
    } catch (err) {
      setError(err.message || "تعذّر إنشاء الشركة");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel form-panel">
      <div className="form-grid" style={{ alignItems: "end" }}>
        {companies.length > 0 && (
          <label>
            الشركة (بيانات حقيقية)
            <select value={companyId || ""} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <label style={{ alignSelf: "center" }}>
          <button type="button" className="btn-ghost" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "إلغاء" : "+ شركة جديدة"}
          </button>
        </label>
      </div>

      {showForm && (
        <div className="form-grid">
          <label>اسم الشركة<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: تيسم برو" /></label>
          <label>الاسم المختصر (اختياري)<input type="text" value={shortName} onChange={(e) => setShortName(e.target.value)} /></label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? "جارٍ الحفظ..." : "إنشاء الشركة"}
            </button>
          </label>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
      {companies.length === 0 && !showForm && (
        <p className="note">أنشئ أول شركة لبدء تسجيل القيود اليومية والتقارير المالية.</p>
      )}
    </div>
  );
}
