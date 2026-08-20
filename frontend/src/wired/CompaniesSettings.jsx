import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { createCompany, deleteCompany } from "../api/companies";
import { useAuth } from "../context/AuthContext";
import CompanyEditModal from "./CompanyEditModal";
import CompanyZatcaModal from "./CompanyZatcaModal";
import { COUNTRIES, CURRENCIES, countryName, defaultCurrencyForCountry } from "../shared/countries";

/** تعديل اسم المنشأة (المستأجر) — لا يوجد له مسار آخر بعد التسجيل الأول، وهو ضروري خصوصاً
 * لتصحيح اسم أُدخل بترميز خاطئ عند إنشاء الحساب لأول مرة (مثلاً عبر إدخال مباشر في قاعدة
 * البيانات بترميز غير UTF-8) — يظهر هذا الاسم في السطر العلوي وفي الشريط الجانبي. */
function TenantNameSettings() {
  const { t } = useTranslation();
  const { tenant, renameTenant } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tenant?.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) { setError(t("settings.tenantName.errRequired")); return; }
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
      <h3>{t("settings.tenantName.title")}</h3>
      {editing ? (
        <div className="form-grid" style={{ alignItems: "end" }}>
          <label>{t("settings.tenantName.label")}<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t("settings.myAccount.saving") : t("common.save")}</button>
          </label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-ghost" onClick={() => { setEditing(false); setName(tenant?.name || ""); setError(""); }}>{t("common.cancel")}</button>
          </label>
        </div>
      ) : (
        <div className="form-btn-group">
          <span className="status-badge">{tenant?.name}</span>
          <button className="btn-ghost" onClick={() => setEditing(true)}>{t("settings.tenantName.editBtn")}</button>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}

/** إنشاء شركة جديدة — المكان الوحيد في النظام لإضافة شركة (لم يعد متاحاً من أي شاشة معاملات) */
function NewCompanyForm({ onCompanyCreated }) {
  const { t, i18n } = useTranslation();
  const BUSINESS_ACTIVITY_OPTIONS = [
    { value: "", label: t("settings.newCompany.businessActivity.none") },
    { value: "contracting", label: t("settings.newCompany.businessActivity.contracting") },
    { value: "manufacturing", label: t("settings.newCompany.businessActivity.manufacturing") },
    { value: "retail", label: t("settings.newCompany.businessActivity.retail") },
    { value: "general_trade", label: t("settings.newCompany.businessActivity.generalTrade") },
    { value: "fuel_stations", label: t("settings.newCompany.businessActivity.fuelStations") },
  ];

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [businessActivity, setBusinessActivity] = useState("");
  const [country, setCountry] = useState("SA");
  const [currency, setCurrency] = useState("SAR");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // اختيار الدولة يقترح عملتها الافتراضية تلقائياً (قابلة للتعديل بعد ذلك دون أن يُعاد الكتابة
  // فوقها لو غيّر المستخدم الدولة مجدداً بالخطأ ثم رجع — الاقتراح فقط، لا فرض).
  const onCountryChange = (value) => {
    setCountry(value);
    setCurrency(defaultCurrencyForCountry(value));
  };

  const submit = async () => {
    if (!name.trim()) { setError(t("settings.newCompany.errNameRequired")); return; }
    setSaving(true);
    setError("");
    try {
      const company = await createCompany({
        name: name.trim(),
        shortName: shortName.trim() || undefined,
        businessActivity: businessActivity || undefined,
        country,
        currency,
      });
      setName("");
      setShortName("");
      setBusinessActivity("");
      setCountry("SA");
      setCurrency("SAR");
      setShowForm(false);
      onCompanyCreated?.(company);
    } catch (err) {
      setError(err.message || t("settings.newCompany.errGeneric"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel form-panel">
      <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{t("settings.newCompany.title")}</h3>
        <button type="button" className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("common.cancel") : t("settings.newCompany.newBtn")}
        </button>
      </div>
      {showForm && (
        <div className="form-grid" style={{ marginTop: 14 }}>
          <label>{t("settings.newCompany.nameLabel")}<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.newCompany.namePlaceholder")} /></label>
          <label>{t("settings.newCompany.shortNameLabel")}<input type="text" value={shortName} onChange={(e) => setShortName(e.target.value)} /></label>
          <label>
            {t("settings.newCompany.businessActivityLabel")}
            <select value={businessActivity} onChange={(e) => setBusinessActivity(e.target.value)}>
              {BUSINESS_ACTIVITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label>
            {t("settings.newCompany.countryLabel")}
            <select value={country} onChange={(e) => onCountryChange(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{countryName(c.code, i18n.language)}</option>
              ))}
            </select>
          </label>
          <label>
            {t("settings.newCompany.currencyLabel")}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.symbolAr}</option>
              ))}
            </select>
            <small style={{ color: "#8A7C5E", fontSize: 11 }}>{t("settings.newCompany.currencyHint")}</small>
          </label>
          <div style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? t("settings.newCompany.creating") : t("settings.newCompany.createBtn")}
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
  const { t } = useTranslation();
  const [editingCompany, setEditingCompany] = useState(null);
  const [zatcaCompany, setZatcaCompany] = useState(null);
  const [error, setError] = useState("");

  const remove = async (c) => {
    if (!window.confirm(t("settings.companiesList.confirmDelete", { name: c.name }))) return;
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
        <thead><tr><th>{t("settings.companiesList.table.name")}</th><th>{t("settings.companiesList.table.shortName")}</th><th>{t("settings.companiesList.table.vatNumber")}</th><th>{t("settings.companiesList.table.crNumber")}</th><th></th></tr></thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.shortName || "—"}</td>
              <td>{c.vatNumber || "—"}</td>
              <td>{c.crNumber || "—"}</td>
              <td className="row-actions">
                <button className="btn-ghost" onClick={() => setEditingCompany(c)}>{t("common.edit")}</button>
                {c.country === "SA" && (
                  <button className="btn-ghost" onClick={() => setZatcaCompany(c)}>{t("settings.companiesList.zatcaLink")}</button>
                )}
                <button className="btn-ghost" onClick={() => remove(c)}>{t("common.delete")}</button>
              </td>
            </tr>
          ))}
          {companies.length === 0 && <tr><td className="empty" colSpan={5}>{t("settings.companiesList.empty")}</td></tr>}
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
