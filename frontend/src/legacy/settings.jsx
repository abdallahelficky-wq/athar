import React, { useState } from "react";
import { COMPANIES, PERMISSION_ROLES, COMPANY_DOC_TYPES, COST_CENTERS } from "./constants";
import CompaniesSettings from "../wired/CompaniesSettings";
import MyAccountSettings from "../wired/MyAccountSettings";
import UsersTab from "../wired/UsersTab";
import SubTabs from "../wired/shared/SubTabs";

export function MyProfileSettings({ currentUser, setCurrentUser }) {
  const [form, setForm] = useState(currentUser);
  const save = () => setCurrentUser(form);
  return (
    <div className="panel form-panel">
      <div className="form-grid">
        <label>الاسم الكامل<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>الدور الوظيفي<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{PERMISSION_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
      </div>
      <button className="btn-primary" onClick={save}>حفظ الملف الشخصي</button>
    </div>
  );
}

export function JobTitlesSettings({ jobTitles, setJobTitles }) {
  const [title, setTitle] = useState("");
  const add = () => { if (!title.trim()) return; setJobTitles((prev) => [...prev, title.trim()]); setTitle(""); };
  const remove = (t) => setJobTitles((prev) => prev.filter((x) => x !== t));
  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label className="memo-field">مسمّى وظيفي جديد<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: مشرف مبيعات" /></label>
        </div>
        <button className="btn-primary" onClick={add}>إضافة</button>
      </div>
      <div className="panel">
        <div className="tag-cloud">
          {jobTitles.map((t) => (
            <span key={t} className="tag-chip">{t}<button onClick={() => remove(t)}>✕</button></span>
          ))}
        </div>
        {jobTitles.length === 0 && <p className="empty">لا توجد مسمّيات وظيفية مسجّلة بعد.</p>}
      </div>
    </div>
  );
}

export function LocationsSettings({ onDataChange }) {
  const [form, setForm] = useState({ name: "", company: "tesm" });
  const [, forceRerender] = useState(0);

  const add = () => {
    if (!form.name) return;
    COST_CENTERS.push({ id: "cc-" + Date.now(), name: form.name, company: form.company });
    setForm({ name: "", company: form.company });
    onDataChange(); forceRerender((v) => v + 1);
  };
  const remove = (id) => {
    const idx = COST_CENTERS.findIndex((c) => c.id === id);
    if (idx > -1) COST_CENTERS.splice(idx, 1);
    onDataChange(); forceRerender((v) => v + 1);
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>اسم الموقع / الفرع<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: محطة الروضة الجديدة" /></label>
          <label>الشركة<select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="all">عام لكل الشركات</option>
            {COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        </div>
        <button className="btn-primary" onClick={add}>إضافة موقع</button>
      </div>
      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الموقع</th><th>الشركة</th><th></th></tr></thead>
          <tbody>
            {COST_CENTERS.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.company === "all" ? "عام" : COMPANIES.find((x) => x.id === c.company)?.name}</td>
                <td><button className="btn-ghost" onClick={() => remove(c.id)}>حذف</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">هذه المواقع تُستخدم كمراكز تكلفة في القيود، ومخازن في وحدة المخزون، وأفرع للموظفين.</p>
    </div>
  );
}

export function CompanyDocumentsSettings({ companyDocuments, setCompanyDocuments }) {
  const [form, setForm] = useState({ company: "tesm", docType: COMPANY_DOC_TYPES[0], location: "", number: "", expiryDate: "" });
  const locationOptions = COST_CENTERS.filter((c) => c.company === "all" || c.company === form.company);

  const add = () => {
    if (!form.number) return;
    setCompanyDocuments((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((d) => d.id)) + 1 : 1, ...form }]);
    setForm((f) => ({ ...f, number: "", expiryDate: "" }));
  };
  const remove = (id) => setCompanyDocuments((prev) => prev.filter((d) => d.id !== id));

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الشركة<select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value, location: "" })}>{COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>نوع المستند<select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>{COMPANY_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>الموقع (اختياري — للمستندات الخاصة بموقع مثل الدفاع المدني)
            <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
              <option value="">— عام للشركة —</option>
              {locationOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>رقم المستند<input type="text" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></label>
          <label>تاريخ الانتهاء<input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></label>
        </div>
        <button className="btn-primary" onClick={add}>حفظ المستند</button>
      </div>
      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الشركة</th><th>نوع المستند</th><th>الموقع</th><th>الرقم</th><th>تاريخ الانتهاء</th><th></th></tr></thead>
          <tbody>
            {companyDocuments.map((d) => {
              const days = d.expiryDate ? daysUntil(d.expiryDate) : null;
              const cls = days == null ? "" : days < 0 ? "balance-bad" : days <= 30 ? "doc-warning-text" : "";
              return (
                <tr key={d.id}>
                  <td>{COMPANIES.find((c) => c.id === d.company)?.name}</td>
                  <td>{d.docType}</td>
                  <td>{d.location ? costCenterName(d.location) : "عام"}</td>
                  <td>{d.number}</td>
                  <td className={cls}>{d.expiryDate || "—"}</td>
                  <td><button className="btn-ghost" onClick={() => remove(d.id)}>حذف</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {companyDocuments.length === 0 && <p className="empty">لا توجد مستندات رسمية مسجّلة بعد.</p>}
      </div>
    </div>
  );
}

export const SETTINGS_TABS = [
  { id: "companies", labelKey: "nav.tabs.companies" },
  { id: "profile", labelKey: "nav.tabs.profile" },
  { id: "users", labelKey: "nav.tabs.users" },
  { id: "jobTitles", labelKey: "nav.tabs.jobTitles" },
  { id: "locations", labelKey: "nav.tabs.locations" },
  { id: "companyDocs", labelKey: "nav.tabs.companyDocs" },
];

export function SettingsModule({ tab, setTab, currentUser, setCurrentUser, jobTitles, setJobTitles, companyDocuments, setCompanyDocuments, onDataChange, realCompanies, reloadRealCompanies, onRealCompanyCreated }) {
  return (
    <div>
      <div className="section-title"><span className="eyebrow">إدارة النظام</span><h2>الإعدادات</h2></div>
      <SubTabs tabs={SETTINGS_TABS} active={tab} onChange={setTab} />
      {tab === "companies" && <CompaniesSettings companies={realCompanies} reload={reloadRealCompanies} onCompanyCreated={onRealCompanyCreated} />}
      {tab === "profile" && (
        <div>
          <MyAccountSettings />
          <MyProfileSettings currentUser={currentUser} setCurrentUser={setCurrentUser} />
        </div>
      )}
      {tab === "users" && <UsersTab realCompanies={realCompanies} />}
      {tab === "jobTitles" && <JobTitlesSettings jobTitles={jobTitles} setJobTitles={setJobTitles} />}
      {tab === "locations" && <LocationsSettings onDataChange={onDataChange} />}
      {tab === "companyDocs" && <CompanyDocumentsSettings companyDocuments={companyDocuments} setCompanyDocuments={setCompanyDocuments} />}
    </div>
  );
}
