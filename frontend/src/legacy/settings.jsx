import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { COMPANIES, PERMISSION_ROLES, COMPANY_DOC_TYPES, COST_CENTERS } from "./constants";
import CompaniesSettings from "../wired/CompaniesSettings";
import MyAccountSettings from "../wired/MyAccountSettings";
import UsersTab from "../wired/UsersTab";
import SubTabs from "../wired/shared/SubTabs";
import { useModuleTab } from "../wired/shared/useModuleTab";

export function MyProfileSettings({ currentUser, setCurrentUser }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(currentUser);
  const save = () => setCurrentUser(form);
  return (
    <div className="panel form-panel">
      <div className="form-grid">
        <label>{t("settings.profile.nameLabel")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>{t("settings.profile.emailLabel")}<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>{t("settings.profile.roleLabel")}<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{PERMISSION_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
      </div>
      <button className="btn-primary" onClick={save}>{t("settings.profile.saveBtn")}</button>
    </div>
  );
}

export function JobTitlesSettings({ jobTitles, setJobTitles }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const add = () => { if (!title.trim()) return; setJobTitles((prev) => [...prev, title.trim()]); setTitle(""); };
  const remove = (t2) => setJobTitles((prev) => prev.filter((x) => x !== t2));
  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label className="memo-field">{t("settings.jobTitles.newTitleLabel")}<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("settings.jobTitles.placeholder")} /></label>
        </div>
        <button className="btn-primary" onClick={add}>{t("common.add")}</button>
      </div>
      <div className="panel">
        <div className="tag-cloud">
          {jobTitles.map((t2) => (
            <span key={t2} className="tag-chip">{t2}<button onClick={() => remove(t2)}>✕</button></span>
          ))}
        </div>
        {jobTitles.length === 0 && <p className="empty">{t("settings.jobTitles.empty")}</p>}
      </div>
    </div>
  );
}

export function LocationsSettings({ onDataChange }) {
  const { t } = useTranslation();
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
          <label>{t("settings.locations.nameLabel")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("settings.locations.namePlaceholder")} /></label>
          <label>{t("settings.locations.companyLabel")}<select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="all">{t("settings.locations.generalOption")}</option>
            {COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        </div>
        <button className="btn-primary" onClick={add}>{t("settings.locations.addBtn")}</button>
      </div>
      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>{t("settings.locations.table.location")}</th><th>{t("settings.locations.table.company")}</th><th></th></tr></thead>
          <tbody>
            {COST_CENTERS.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.company === "all" ? t("settings.locations.generalValue") : COMPANIES.find((x) => x.id === c.company)?.name}</td>
                <td><button className="btn-ghost" onClick={() => remove(c.id)}>{t("common.delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t("settings.locations.note")}</p>
    </div>
  );
}

export function CompanyDocumentsSettings({ companyDocuments, setCompanyDocuments }) {
  const { t } = useTranslation();
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
          <label>{t("settings.companyDocsLegacy.companyLabel")}<select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value, location: "" })}>{COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{t("settings.companyDocsLegacy.docTypeLabel")}<select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>{COMPANY_DOC_TYPES.map((t2) => <option key={t2}>{t2}</option>)}</select></label>
          <label>{t("settings.companyDocsLegacy.locationLabel")}
            <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
              <option value="">{t("settings.companyDocsLegacy.generalOption")}</option>
              {locationOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t("settings.companyDocsLegacy.numberLabel")}<input type="text" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></label>
          <label>{t("settings.companyDocsLegacy.expiryLabel")}<input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></label>
        </div>
        <button className="btn-primary" onClick={add}>{t("settings.companyDocsLegacy.saveBtn")}</button>
      </div>
      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>{t("settings.companyDocsLegacy.table.company")}</th><th>{t("settings.companyDocsLegacy.table.docType")}</th><th>{t("settings.companyDocsLegacy.table.location")}</th><th>{t("settings.companyDocsLegacy.table.number")}</th><th>{t("settings.companyDocsLegacy.table.expiry")}</th><th></th></tr></thead>
          <tbody>
            {companyDocuments.map((d) => {
              const days = d.expiryDate ? daysUntil(d.expiryDate) : null;
              const cls = days == null ? "" : days < 0 ? "balance-bad" : days <= 30 ? "doc-warning-text" : "";
              return (
                <tr key={d.id}>
                  <td>{COMPANIES.find((c) => c.id === d.company)?.name}</td>
                  <td>{d.docType}</td>
                  <td>{d.location ? costCenterName(d.location) : t("settings.companyDocsLegacy.generalValue")}</td>
                  <td>{d.number}</td>
                  <td className={cls}>{d.expiryDate || "—"}</td>
                  <td><button className="btn-ghost" onClick={() => remove(d.id)}>{t("common.delete")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {companyDocuments.length === 0 && <p className="empty">{t("settings.companyDocsLegacy.empty")}</p>}
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

export function SettingsModule({ currentUser, setCurrentUser, jobTitles, setJobTitles, companyDocuments, setCompanyDocuments, onDataChange, realCompanies, reloadRealCompanies, onRealCompanyCreated }) {
  const { t } = useTranslation();
  const [tab] = useModuleTab("/settings", SETTINGS_TABS);
  return (
    <div>
      <div className="section-title"><span className="eyebrow">{t("settings.eyebrow")}</span><h2>{t("nav.groups.settings")}</h2></div>
      <SubTabs tabs={SETTINGS_TABS} active={tab} basePath="/settings" />
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
