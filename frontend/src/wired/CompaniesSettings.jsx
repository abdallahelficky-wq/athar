import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createCompany, createIndependentCompany, setBalancesPostedOnly, setPayrollTotalsFromMonth } from "../api/companies";
import { getDraftEntriesSummary } from "../api/reports";
import { fmt } from "../legacy/constants";
import { useAuth } from "../context/AuthContext";
import { changeUnlockPin } from "../api/auth";
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
      <TenantPortalCode code={tenant?.code} />
    </div>
  );
}

/** رمز المنشأة الرقمي الذي يكتبه الموظفون في بوابة الجوال (Tenant.code) — للقراءة فقط، يُسلَّم للموظفين */
function TenantPortalCode({ code }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* المتصفح منع الحافظة — الرقم ظاهر ويمكن نسخه يدوياً */ }
  };
  return (
    <div className="tenant-portal-code">
      <div className="tenant-portal-code-label">{t("settings.tenantName.portalCodeLabel")}</div>
      <div className="form-btn-group">
        <span className="tenant-portal-code-value" dir="ltr">{code}</span>
        <button className="btn-ghost" onClick={copy}>{copied ? t("settings.tenantName.portalCodeCopied") : t("settings.tenantName.portalCodeCopy")}</button>
      </div>
      <p className="note">{t("settings.tenantName.portalCodeNote")}</p>
    </div>
  );
}

/** الرقم السري لفك الترحيل — لمالك الشركة وحده (الخادم يرفض غيره). كل محاولة برقم حالي خاطئ تُسجَّل
 * باسمه وتحتسب ضمن قفل الـ5 محاولات، تماماً كفك الترحيل نفسه. */
function UnlockPinSettings() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const reset = () => { setCurrentPin(""); setNewPin(""); setConfirmPin(""); setError(""); };

  const save = async () => {
    if (!/^\d{4,8}$/.test(newPin)) { setError(t("settings.unlockPin.errFormat")); return; }
    if (newPin !== confirmPin) { setError(t("settings.unlockPin.errMismatch")); return; }
    setSaving(true);
    setError("");
    try {
      await changeUnlockPin({ currentPin, newPin });
      reset();
      setOpen(false);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel form-panel">
      <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{t("settings.unlockPin.title")}</h3>
        <button type="button" className="btn-ghost" onClick={() => { setOpen((v) => !v); reset(); setDone(false); }}>
          {open ? t("common.cancel") : t("settings.unlockPin.changeBtn")}
        </button>
      </div>
      <p className="note" style={{ marginTop: 8 }}>{t("settings.unlockPin.note")}</p>
      {done && <p className="unlock-pin-done">{t("settings.unlockPin.done")}</p>}
      {open && (
        <div className="form-grid">
          <label>{t("settings.unlockPin.current")}<input type="password" inputMode="numeric" autoComplete="off" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} /></label>
          <label>{t("settings.unlockPin.new")}<input type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(e) => setNewPin(e.target.value)} /></label>
          <label>{t("settings.unlockPin.confirm")}<input type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} /></label>
          <div style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={save} disabled={saving || !currentPin || !newPin}>
              {saving ? t("settings.myAccount.saving") : t("common.save")}
            </button>
          </div>
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
    { value: "horse_stables", label: t("settings.newCompany.businessActivity.horseStables") },
  ];

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [businessActivity, setBusinessActivity] = useState("");
  const [country, setCountry] = useState("SA");
  const [currency, setCurrency] = useState("SAR");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // "group" = ضمن نفس المجموعة (المستأجر الحالي، كما كان دائماً)، "independent" = مستأجر جديد كلياً
  const [mode, setMode] = useState("group");
  const [independentResult, setIndependentResult] = useState(null);
  const [switching, setSwitching] = useState(false);
  const { switchAccount } = useAuth();
  const isIndependent = mode === "independent";
  // المستقلة تُزرَع بدالة التسجيل نفسها، والتي تشترط النشاط — فلا خيار "بدون تحديد" لها
  const activityOptions = isIndependent ? BUSINESS_ACTIVITY_OPTIONS.filter((opt) => opt.value) : BUSINESS_ACTIVITY_OPTIONS;

  // اختيار الدولة يقترح عملتها الافتراضية تلقائياً (قابلة للتعديل بعد ذلك دون أن يُعاد الكتابة
  // فوقها لو غيّر المستخدم الدولة مجدداً بالخطأ ثم رجع — الاقتراح فقط، لا فرض).
  const onCountryChange = (value) => {
    setCountry(value);
    setCurrency(defaultCurrencyForCountry(value));
  };

  const resetFields = () => {
    setName("");
    setShortName("");
    setBusinessActivity("");
    setCountry("SA");
    setCurrency("SAR");
  };

  const chooseMode = (value) => {
    setMode(value);
    setError("");
  };

  const submitIndependent = async () => {
    if (!businessActivity) { setError(t("settings.newCompany.independent.errActivityRequired")); return; }
    setSaving(true);
    setError("");
    try {
      const result = await createIndependentCompany({
        name: name.trim(),
        shortName: shortName.trim() || undefined,
        businessActivity,
        country,
        currency,
      });
      resetFields();
      setShowForm(false);
      setMode("group");
      setIndependentResult(result);
    } catch (err) {
      setError(err.message || t("settings.newCompany.errGeneric"));
    } finally {
      setSaving(false);
    }
  };

  // انتقال صريح يطلبه المستخدم بنفسه — ثم إعادة تحميل كاملة حتى لا يبقى في الذاكرة أي بيانات مُحمَّلة
  // من المستأجر الحالي داخل جلسة المستأجر الجديد
  const switchToIndependent = async () => {
    setSwitching(true);
    setError("");
    try {
      await switchAccount(independentResult.userId);
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err.message || t("settings.newCompany.independent.errSwitch"));
      setSwitching(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) { setError(t("settings.newCompany.errNameRequired")); return; }
    if (isIndependent) { await submitIndependent(); return; }
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
      {independentResult && (
        <div className="independent-result" role="status">
          <div className="independent-result-title">{t("settings.newCompany.independent.createdTitle", { name: independentResult.company.name })}</div>
          <p>{t("settings.newCompany.independent.createdCode")} <strong className="independent-code">{independentResult.tenant.code}</strong></p>
          <p className="note" style={{ margin: "0 0 12px" }}>{t("settings.newCompany.independent.createdNote")}</p>
          <div className="form-btn-group">
            <button type="button" className="btn-primary" onClick={switchToIndependent} disabled={switching}>
              {switching ? t("settings.newCompany.independent.switching") : t("settings.newCompany.independent.switchNow")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setIndependentResult(null)} disabled={switching}>
              {t("settings.newCompany.independent.stayHere")}
            </button>
          </div>
        </div>
      )}
      {showForm && (
        <fieldset className="company-mode-choice" style={{ marginTop: 14 }}>
          <legend>{t("settings.newCompany.modeLabel")}</legend>
          <label className={"company-mode-option" + (mode === "group" ? " selected" : "")}>
            <input type="radio" name="company-mode" value="group" checked={mode === "group"} onChange={() => chooseMode("group")} />
            <span>
              <strong>{t("settings.newCompany.group.title")}</strong>
              <small>{t("settings.newCompany.group.desc")}</small>
            </span>
          </label>
          <label className={"company-mode-option" + (isIndependent ? " selected" : "")}>
            <input type="radio" name="company-mode" value="independent" checked={isIndependent} onChange={() => chooseMode("independent")} />
            <span>
              <strong>{t("settings.newCompany.independent.title")}</strong>
              <small>{t("settings.newCompany.independent.desc")}</small>
            </span>
          </label>
          {isIndependent && (
            <div className="independent-warning">
              <strong>{t("settings.newCompany.independent.warningTitle")}</strong>
              <ul>
                <li>{t("settings.newCompany.independent.warnNoUsers")}</li>
                <li>{t("settings.newCompany.independent.warnNoReports")}</li>
                <li>{t("settings.newCompany.independent.warnNoTransfers")}</li>
                <li>{t("settings.newCompany.independent.warnOwnCode")}</li>
                <li>{t("settings.newCompany.independent.warnOwnSubscription")}</li>
                <li>{t("settings.newCompany.independent.warnAccess")}</li>
              </ul>
            </div>
          )}
        </fieldset>
      )}
      {showForm && (
        <div className="form-grid" style={{ marginTop: 14 }}>
          <label>{t("settings.newCompany.nameLabel")}<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.newCompany.namePlaceholder")} /></label>
          <label>{t("settings.newCompany.shortNameLabel")}<input type="text" value={shortName} onChange={(e) => setShortName(e.target.value)} /></label>
          <label>
            {t("settings.newCompany.businessActivityLabel")}
            <select value={businessActivity} onChange={(e) => setBusinessActivity(e.target.value)}>
              {isIndependent && <option value="">{t("settings.newCompany.independent.selectActivity")}</option>}
              {activityOptions.map((opt) => (
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
              {saving ? t("settings.newCompany.creating") : isIndependent ? t("settings.newCompany.independent.createBtn") : t("settings.newCompany.createBtn")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}

/**
 * مفتاح "الأرصدة تحتسب المرحَّل فقط" لكل شركة — للمالك وحده. عند تفعيله تخرج القيود المحفوظة (غير
 * المرحّلة) من كل الأرصدة والقوائم ولوحة المتابعة؛ عدد تلك القيود ومجموعها معروضان قبل التفعيل حتى يُعرف
 * أثره مسبقاً. كل تغيير مسجَّل في سجل التدقيق.
 */
function BalancesPostedOnlySettings({ companies, reload }) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all(companies.map((c) => getDraftEntriesSummary({ companyId: c.id }).then((d) => [c.id, d]).catch(() => [c.id, null])))
      .then((pairs) => { if (live) setDrafts(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [companies]);

  const toggle = async (company) => {
    const enabling = !company.balancesPostedOnly;
    const d = drafts[company.id];
    const pending = d ? d.uncounted.entryCount + d.counted.entryCount : 0;
    if (enabling && !window.confirm(t("settings.balancesPostedOnly.confirmEnable", { company: company.name, count: pending }))) return;
    if (!enabling && !window.confirm(t("settings.balancesPostedOnly.confirmDisable", { company: company.name }))) return;
    setBusyId(company.id); setError("");
    try {
      await setBalancesPostedOnly(company.id, enabling);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="panel form-panel" data-testid="balances-posted-only-settings">
      <h3>{t("settings.balancesPostedOnly.title")}</h3>
      <p className="note">{t("settings.balancesPostedOnly.note")}</p>
      {error && <p className="balance-bad">{error}</p>}
      <table className="ledger-table">
        <thead>
          <tr><th>{t("settings.balancesPostedOnly.company")}</th><th>{t("settings.balancesPostedOnly.state")}</th><th>{t("settings.balancesPostedOnly.savedEntries")}</th><th></th></tr>
        </thead>
        <tbody>
          {companies.map((c) => {
            const d = drafts[c.id];
            const saved = d ? { count: d.uncounted.entryCount + d.counted.entryCount, debit: d.uncounted.debit + d.counted.debit } : null;
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.balancesPostedOnly ? t("settings.balancesPostedOnly.on") : <span className="balance-bad">{t("settings.balancesPostedOnly.off")}</span>}</td>
                <td>
                  {saved === null ? "…" : saved.count === 0 ? "—" : (
                    t("settings.balancesPostedOnly.savedSummary", { count: saved.count, debit: fmt(saved.debit) })
                  )}
                </td>
                <td>
                  <button className={c.balancesPostedOnly ? "btn-ghost" : "btn-primary"} disabled={busyId === c.id} onClick={() => toggle(c)}>
                    {c.balancesPostedOnly ? t("settings.balancesPostedOnly.disable") : t("settings.balancesPostedOnly.enable")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * أول شهر يُرحَّل فيه كشف الرواتب إجماليات لكل بند وصافٍ واحد على «رواتب مستحقة للصرف» — للمالك وحده، لكل
 * شركة. فارغ = الترحيل القديم (سطر لكل موظف وصافٍ على حسابه الفرعي). الكشوف المرحَّلة قبله لا يُعاد كتابتها،
 * وأرصدة الحسابات الفرعية القائمة تُصرَف منها كما هي. كل تغيير مسجَّل في سجل التدقيق.
 */
function PayrollTotalsSettings({ companies, reload }) {
  const { t } = useTranslation();
  const [months, setMonths] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const save = async (company, month) => {
    if (month && !window.confirm(t("settings.payrollTotals.confirm", { company: company.name, month }))) return;
    setBusyId(company.id); setError("");
    try {
      await setPayrollTotalsFromMonth(company.id, month || null);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="panel form-panel" data-testid="payroll-totals-settings">
      <h3>{t("settings.payrollTotals.title")}</h3>
      <p className="note">{t("settings.payrollTotals.note")}</p>
      {error && <p className="balance-bad">{error}</p>}
      <table className="ledger-table">
        <thead>
          <tr><th>{t("settings.payrollTotals.company")}</th><th>{t("settings.payrollTotals.current")}</th><th>{t("settings.payrollTotals.fromMonth")}</th><th></th></tr>
        </thead>
        <tbody>
          {companies.map((c) => {
            const draft = months[c.id] ?? c.payrollTotalsFromMonth ?? "";
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.payrollTotalsFromMonth ? t("settings.payrollTotals.since", { month: c.payrollTotalsFromMonth }) : t("settings.payrollTotals.legacy")}</td>
                <td><input type="month" value={draft} onChange={(e) => setMonths({ ...months, [c.id]: e.target.value })} /></td>
                <td>
                  <button className="btn-primary" disabled={busyId === c.id || draft === (c.payrollTotalsFromMonth ?? "")} onClick={() => save(c, draft)}>
                    {!draft && c.payrollTotalsFromMonth ? t("settings.payrollTotals.clear") : t("settings.payrollTotals.save")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const { user, tenant } = useAuth();
  const isOwner = user?.role === "super_admin" || (tenant?.ownerId && tenant.ownerId === user?.id);

  const handleCreated = (company) => {
    onCompanyCreated?.(company);
    reload();
  };

  return (
    <div>
      <TenantNameSettings />
      {isOwner && <UnlockPinSettings />}
      {isOwner && companies.length > 0 && <BalancesPostedOnlySettings companies={companies} reload={reload} />}
      {isOwner && companies.length > 0 && <PayrollTotalsSettings companies={companies} reload={reload} />}
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
