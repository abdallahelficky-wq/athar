import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/http";

const labels = { queued: "بانتظار الإرسال", blocked: "تعذر الإرسال", sending: "جارٍ الإرسال", sent: "أُرسل", uncertain: "تحتاج مراجعة في قيود — لا تعِد الإرسال" };
export default function QoyodSettings({ companyId }) {
  const url = `/companies/${companyId}/qoyod`;
  const [data, setData] = useState(null), [mapping, setMapping] = useState({ accounts: {}, contacts: {} });
  const [apiKey, setApiKey] = useState(""), [enabled, setEnabled] = useState(false), [search, setSearch] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState(null);
  const load = async () => { const result = await apiFetch(url); setData(result); setMapping(result.mapping); setEnabled(result.enabled); };
  useEffect(() => { load().catch(e => setError(e.message)); }, [companyId]);
  const run = async action => { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const change = (group, id, value) => setMapping(previous => { const next = { ...previous, [group]: { ...previous[group] } }; if (value) next[group][id] = Number(value); else delete next[group][id]; return next; });
  const save = () => run(async () => {
    await apiFetch(url, { method: "PUT", body: { enabled, mapping, ...(apiKey ? { apiKey } : {}) } });
    setApiKey(""); await load(); setMessage("تم حفظ إعدادات الربط. يبدأ الإرسال للقيود التي تُرحّل بعد التفعيل.");
  });
  return <section className="panel form-panel" dir="rtl">
    <h3>ربط القيود اليومية مع قيود — أرمي</h3>
    <p className="note">يرسل القيود المرحّلة الجديدة، بما فيها القيود الناتجة عن المعاملات. لا يرسل الفواتير كمستندات ولا يعيد إرسال القيود القديمة. بعد بدء الإرسال يُصحّح القيد بقيد عكسي.</p>
    {error && <p role="alert" className="balance-bad">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!data ? <p>جارٍ تحميل الإعدادات…</p> : <>
      <label>مفتاح API لشركة أرمي في قيود {data.configured && "(محفوظ؛ اتركه فارغًا للاحتفاظ به)"}
        <input type="password" autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={busy} />
      </label>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={busy} /> تفعيل الإرسال التلقائي</label>
      <details><summary>مطابقة الحسابات والأطراف</summary>
        <p className="note">احفظ المفتاح أولًا دون تفعيل، ثم حمّل دليل قيود واختر الحساب المقابل. اترك الحسابات غير المستخدمة فارغة؛ أي قيد يحتاج مطابقة ناقصة يتوقف حتى تُستكمل.</p>
        <button className="btn-ghost" disabled={busy || !data.configured} onClick={() => run(async () => setDirectory(await apiFetch(`${url}/directory`)))}>تحميل دليل قيود للمطابقة</button>
        <input aria-label="بحث الحسابات" placeholder="بحث باسم الحساب أو رمزه" value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ maxHeight: 360, overflow: "auto" }}><table className="ledger-table"><thead><tr><th>حساب أثر</th><th>ID الحساب في قيود</th></tr></thead><tbody>
          {data.accounts.filter(a => `${a.code} ${a.name}`.includes(search)).map(a => <tr key={a.id}><td>{a.code} — {a.name}</td><td>{directory ? <select aria-label={`قيود ${a.code}`} value={mapping.accounts[a.id] || ""} onChange={e => change("accounts", a.id, e.target.value)}><option value="">غير مربوط</option>{directory.accounts.map(target => <option key={target.id} value={target.id}>{target.code} — {target.name}</option>)}</select> : <input aria-label={`قيود ${a.code}`} type="number" min="1" step="1" value={mapping.accounts[a.id] || ""} onChange={e => change("accounts", a.id, e.target.value)} />}</td></tr>)}
        </tbody></table></div>
        {[ ["customer", "العملاء", data.customers], ["supplier", "الموردون", data.suppliers] ].map(([kind, title, rows]) => <details key={kind}><summary>{title}</summary>{rows.map(row => <label key={row.id}>{row.name} — المقابل في قيود{directory ? <select value={mapping.contacts[`${kind}:${row.id}`] || ""} onChange={e => change("contacts", `${kind}:${row.id}`, e.target.value)}><option value="">غير مربوط</option>{directory[kind].map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select> : <input type="number" min="1" step="1" value={mapping.contacts[`${kind}:${row.id}`] || ""} onChange={e => change("contacts", `${kind}:${row.id}`, e.target.value)} />}</label>)}</details>)}
      </details>
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "جارٍ التحقق…" : "التحقق وحفظ الربط"}</button>
      <button className="btn-ghost" onClick={() => run(load)} disabled={busy}>تحديث الحالة</button>
      <h4>آخر 100 عملية إرسال</h4>
      <table className="ledger-table"><thead><tr><th>القيد</th><th>الحالة</th><th>رقم قيود</th><th>التفاصيل</th></tr></thead><tbody>
        {data.exports.map(job => <tr key={job.entryId}><td>{job.entry.entryNumber}</td><td>{labels[job.status] || job.status}</td><td>{job.remoteId || "—"}</td><td>{job.error}{job.status === "blocked" && <button disabled={busy} className="btn-ghost" onClick={() => run(async () => { await apiFetch(`${url}/retry/${job.entryId}`, { method: "POST" }); await load(); })}>إعادة المحاولة بعد التصحيح</button>}</td></tr>)}
        {!data.exports.length && <tr><td colSpan={4}>لا توجد قيود في قائمة الإرسال بعد.</td></tr>}
      </tbody></table>
    </>}
  </section>;
}
