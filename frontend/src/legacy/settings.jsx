import React, { useState } from "react";
import { COMPANIES, PERMISSION_ROLES, COMPANY_DOC_TYPES, COST_CENTERS } from "./constants";
import CompaniesSettings from "../wired/CompaniesSettings";
import MyAccountSettings from "../wired/MyAccountSettings";

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

export function emptyUserForm() { return { name: "", email: "", role: PERMISSION_ROLES[PERMISSION_ROLES.length - 1], company: "all", active: true }; }

export function UsersSettings({ users, setUsers, unlockPin, setUnlockPin }) {
  const [form, setForm] = useState(emptyUserForm());
  const [pinForm, setPinForm] = useState(unlockPin);
  const [activatingId, setActivatingId] = useState(null);
  const [activatePwd, setActivatePwd] = useState("");

  const inviteUser = () => {
    if (!form.name || !form.email) return;
    setUsers((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((u) => u.id)) + 1 : 1, ...form, active: false, password: null, inviteStatus: "pending" }]);
    setForm(emptyUserForm());
  };
  const toggleActive = (id) => setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, active: !u.active } : u)));
  const removeUser = (id) => setUsers((prev) => prev.filter((u) => u.id !== id));
  const confirmActivate = (id) => {
    if (!activatePwd) return;
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, password: activatePwd, active: true, inviteStatus: "accepted" } : u)));
    setActivatingId(null); setActivatePwd("");
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الرقم السري لفك ترحيل المعاملات<input type="password" value={pinForm} onChange={(e) => setPinForm(e.target.value)} /></label>
        </div>
        <button className="btn-primary" onClick={() => setUnlockPin(pinForm)}>حفظ الرقم السري</button>
        <p className="note">هذا الرقم مطلوب لفك ترحيل أي كشف رواتب أو معاملة مرحّلة — احتفظ به لدى المخوّلين فقط.</p>
      </div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الاسم<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>الصلاحية<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{PERMISSION_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label>نطاق الوصول (الشركة)<select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>{COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <button className="btn-primary" onClick={inviteUser}>إرسال دعوة لمستخدم جديد</button>
        <p className="note">
          في نظام حقيقي متصل بخادم بريد، سيصل للمستخدم إيميل تلقائي فيه رابط لتفعيل حسابه وتعيين كلمة مرور.
          بما أن هذا عرض تجريبي بدون خادم بريد فعلي، استخدم زر "محاكاة تفعيل الدعوة" أدناه لتعيين كلمة مرور للمستخدم مباشرة.
        </p>
      </div>
      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الصلاحية</th><th>نطاق الوصول</th><th>حالة الدعوة</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td><td>{u.role}</td>
                <td>{COMPANIES.find((c) => c.id === u.company)?.name}</td>
                <td>{u.inviteStatus === "pending" ? <span className="status-badge">بانتظار التفعيل</span> : <span className="status-badge posted-badge">مفعّل</span>}</td>
                <td><span className="status-badge">{u.active ? "نشط" : "معطّل"}</span></td>
                <td className="row-actions">
                  {u.inviteStatus === "pending" ? (
                    activatingId === u.id ? (
                      <span className="inline-disb">
                        <input type="password" placeholder="كلمة مرور جديدة" value={activatePwd} onChange={(e) => setActivatePwd(e.target.value)} />
                        <button className="btn-primary" onClick={() => confirmActivate(u.id)}>تأكيد</button>
                      </span>
                    ) : (
                      <button className="btn-ghost" onClick={() => setActivatingId(u.id)}>محاكاة تفعيل الدعوة</button>
                    )
                  ) : (
                    <button className="btn-ghost" onClick={() => toggleActive(u.id)}>{u.active ? "تعطيل" : "تفعيل"}</button>
                  )}
                  <button className="btn-ghost" onClick={() => removeUser(u.id)}>حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  { id: "companies", label: "بيانات الشركات" },
  { id: "profile", label: "الملف الشخصي" },
  { id: "users", label: "المستخدمون والصلاحيات" },
  { id: "jobTitles", label: "الوظائف" },
  { id: "locations", label: "المواقع" },
  { id: "companyDocs", label: "المستندات الرسمية" },
];

export function SettingsModule({ tab, setTab, users, setUsers, currentUser, setCurrentUser, jobTitles, setJobTitles, unlockPin, setUnlockPin, companyDocuments, setCompanyDocuments, onDataChange, realCompanies, reloadRealCompanies }) {
  return (
    <div>
      <div className="section-title"><span className="eyebrow">إدارة النظام</span><h2>الإعدادات</h2></div>
      <div className="report-tabs">{SETTINGS_TABS.map((t) => (<button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>))}</div>
      {tab === "companies" && <CompaniesSettings companies={realCompanies} reload={reloadRealCompanies} />}
      {tab === "profile" && (
        <div>
          <MyAccountSettings />
          <MyProfileSettings currentUser={currentUser} setCurrentUser={setCurrentUser} />
        </div>
      )}
      {tab === "users" && <UsersSettings users={users} setUsers={setUsers} unlockPin={unlockPin} setUnlockPin={setUnlockPin} />}
      {tab === "jobTitles" && <JobTitlesSettings jobTitles={jobTitles} setJobTitles={setJobTitles} />}
      {tab === "locations" && <LocationsSettings onDataChange={onDataChange} />}
      {tab === "companyDocs" && <CompanyDocumentsSettings companyDocuments={companyDocuments} setCompanyDocuments={setCompanyDocuments} />}
    </div>
  );
}
