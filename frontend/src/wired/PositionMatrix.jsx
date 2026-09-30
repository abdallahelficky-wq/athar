import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listMatrixResources, savePositionMatrix } from "../api/positions";
import "../styles/position-matrix.css";

const columns = [
  ["read", "القراءة", "Read"], ["create", "الإنشاء", "Create"],
  ["edit", "التعديل", "Edit"], ["delete", "الحذف", "Delete"],
  ["approve", "الاعتماد / الترحيل", "Approve / post"],
];

export default function PositionMatrix({ position, onSaved }) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const [resources, setResources] = useState([]);
  const [draft, setDraft] = useState(position.matrix || {});
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    listMatrixResources().then((rows) => { if (active) setResources(rows); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  const label = (resource) => resource.label[en ? "en" : "ar"];
  const visible = resources.filter((r) => `${r.label.ar} ${r.label.en}`.toLowerCase().includes(search.trim().toLowerCase()));
  function change(rows, actions, checked) {
    setDraft((old) => {
      const next = { ...old };
      rows.forEach((r) => {
        next[r.id] = { ...old[r.id] };
        actions.filter((a) => r.actions.includes(a)).forEach((a) => { next[r.id][a] = checked; });
      });
      return next;
    });
    setDirty(true); setMessage("");
  }
  async function save() {
    if (busy) return;
    if (!position.matrixEnabled && !window.confirm(en
      ? "Saving activates this matrix for assigned users. Unselected permissions will be denied. Continue?"
      : "سيُفعّل الحفظ هذه المصفوفة للمستخدمين المسندين للمنصب، وستُمنع الصلاحيات غير المحددة. هل تريد المتابعة؟")) return;
    setBusy(true); setError("");
    try {
      const rows = resources.map((r) => ({ resourceId: r.id,
        ...Object.fromEntries(columns.map(([a]) => [a, r.actions.includes(a) && !!draft[r.id]?.[a]])) }));
      const updated = await savePositionMatrix(position.id, rows);
      setDraft(updated.matrix); setDirty(false); onSaved(updated);
      setMessage(en ? "Permissions saved." : "تم حفظ الصلاحيات.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="position-matrix" aria-label={en ? "Permission matrix" : "مصفوفة الصلاحيات"}>
    <h3>{en ? "Permission matrix" : "مصفوفة صلاحيات المنصب"}</h3>
    <p className="note">{en ? "Assigned directly to user accounts. Approval is independent of creation and editing." : "يُعيّن المنصب مباشرة لحساب المستخدم. صلاحية الاعتماد مستقلة عن الإنشاء والتعديل."}</p>
    <p className="note">{en ? "Immediate posting requires both Create and Approve. Sensitive HR details also require the personal/payroll data permission. Company scope and owner-only settings remain enforced." : "الحفظ مع الترحيل المباشر يتطلب الإنشاء والاعتماد معًا. تفاصيل الموظفين الحساسة تحتاج أيضًا صلاحية البيانات الشخصية والرواتب. يظل نطاق الشركات وإعدادات المالك ساريًا."}</p>
    {!position.matrixEnabled && <p className="matrix-legacy" role="status">{en ? "This position still uses its previous policy. Saving activates the selected permissions." : "هذا المنصب يعمل بصلاحياته السابقة حاليًا. حفظ المصفوفة يفعّل الصلاحيات المحددة أدناه."}</p>}
    <div className="matrix-toolbar">
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={en ? "Search services…" : "بحث في الخدمات…"} aria-label={en ? "Search services" : "بحث في الخدمات"} />
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => change(visible, columns.map(([a]) => a), true)}>{en ? "Select visible" : "تحديد الخدمات الظاهرة"}</button>
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => change(visible, columns.map(([a]) => a), false)}>{en ? "Clear visible" : "إلغاء تحديد الظاهر"}</button>
    </div>
    <div className="matrix-scroll"><table className="ledger-table">
      <thead><tr><th>{en ? "Service" : "الخدمة"}</th>{columns.map(([action, ar, english]) => {
        const applicable = visible.filter((r) => r.actions.includes(action));
        return <th key={action}><label><input type="checkbox" disabled={busy || !applicable.length}
          checked={!!applicable.length && applicable.every((r) => draft[r.id]?.[action])}
          onChange={(e) => change(applicable, [action], e.target.checked)} />{en ? english : ar}</label></th>;
      })}</tr></thead>
      <tbody>{visible.map((r) => <tr key={r.id}>
        <th scope="row"><label><input type="checkbox" disabled={busy} checked={r.actions.every((a) => draft[r.id]?.[a])}
          aria-label={`${en ? "All permissions for" : "كل صلاحيات"} ${label(r)}`}
          onChange={(e) => change([r], r.actions, e.target.checked)} />{label(r)}</label></th>
        {columns.map(([a, ar, english]) => <td key={a}>{r.actions.includes(a) ? <input type="checkbox"
          disabled={busy} aria-label={`${label(r)} — ${en ? english : ar}`} checked={!!draft[r.id]?.[a]}
          onChange={(e) => change([r], [a], e.target.checked)} /> : <span aria-label={en ? "Not applicable" : "لا ينطبق"}>—</span>}</td>)}
      </tr>)}</tbody>
    </table></div>
    {!resources.length && !error && <p role="status">{en ? "Loading…" : "جارٍ تحميل الخدمات…"}</p>}
    {!!resources.length && !visible.length && <p>{en ? "No matching services." : "لا توجد خدمات مطابقة."}</p>}
    <div className="matrix-footer">
      <button type="button" className="btn-primary" disabled={busy || !resources.length || (!dirty && position.matrixEnabled)} onClick={save}>{busy ? (en ? "Saving…" : "جارٍ الحفظ…") : (en ? "Save permissions" : "حفظ الصلاحيات")}</button>
      {dirty && <span>{en ? "Unsaved changes" : "تعديلات غير محفوظة"}</span>}
      {message && <span role="status">{message}</span>}
      {error && <span role="alert">{error}</span>}
    </div>
  </section>;
}
