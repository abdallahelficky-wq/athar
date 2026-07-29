import React, { useEffect, useMemo, useState } from "react";
import { listAccounts, createAccount, updateAccount, deleteAccount } from "../api/accounts";
import { fmt } from "../legacy/constants";
import { Icon } from "../legacy/shared";

const TYPE_LABEL = { asset: "أصول", liability: "التزامات", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات" };
const emptyForm = { name: "", code: "", type: "asset", parentId: "", isBankOrCash: false };

export default function ChartOfAccountsModule({ companies = [], companyId }) {
  const [scope, setScope] = useState(companyId || "group");
  const [accounts, setAccounts] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [compact, setCompact] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { if (companyId) setScope(companyId); }, [companyId]);
  const reload = () => listAccounts({ tree: true, companyId: scope === "group" ? undefined : scope })
    .then((rows) => { setAccounts(rows); setExpanded(new Set(rows.filter((a) => a.level < 6).map((a) => a.id))); })
    .catch((err) => setError(err.message));
  useEffect(reload, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedParent = accounts.find((a) => a.id === form.parentId);
  const level = selectedParent ? selectedParent.level + 1 : 1;
  const possibleParents = accounts.filter((a) => !a.isPosting && !a.isArchived && a.level < 6 && a.id !== editingId);
  const children = useMemo(() => {
    const map = new Map();
    accounts.forEach((a) => map.set(a.parentId, [...(map.get(a.parentId) || []), a]));
    return map;
  }, [accounts]);

  const rows = [];
  const walk = (parentId = null) => (children.get(parentId) || []).forEach((account) => {
    rows.push(account);
    if (!compact && expanded.has(account.id)) walk(account.id);
  });
  walk();

  const reset = () => { setForm(emptyForm); setEditingId(null); };
  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) return;
    const payload = {
      ...form,
      name: form.name.trim(), code: form.code.trim(), parentId: form.parentId || null,
      companyId: scope === "group" ? null : scope, level, isPosting: level === 6,
      type: selectedParent?.type || form.type,
    };
    try {
      if (editingId) await updateAccount(editingId, payload); else await createAccount(payload);
      reset(); reload();
    } catch (err) { setError(err.message); }
  };
  const edit = (a) => { setEditingId(a.id); setForm({ name: a.name, code: a.code, type: a.type, parentId: a.parentId || "", isBankOrCash: a.isBankOrCash }); };
  const addChild = (a) => { setEditingId(null); setForm({ ...emptyForm, type: a.type, parentId: a.id }); };
  const archive = async (a) => { await updateAccount(a.id, { isArchived: !a.isArchived }); reload(); };
  const remove = async (a) => {
    if (!window.confirm(`حذف حساب "${a.name}"؟`)) return;
    try { await deleteAccount(a.id); reload(); } catch (err) { setError(err.message); }
  };
  const toggle = (id) => setExpanded((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <div>
      {error && <p className="balance-bad">{error}</p>}
      <div className="panel form-panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
          <label>نطاق الشجرة
            <select value={scope} onChange={(e) => { setScope(e.target.value); reset(); }}>
              <option value="group">شجرة المجموعة كاملة</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
            </select>
          </label>
          <button className="btn-ghost" onClick={() => setCompact((v) => !v)}>{compact ? "عرض الشجرة كاملة" : "عرض مصغّر"}</button>
        </div>
        <div className="form-grid">
          <label>اسم الحساب<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>كود الحساب<input inputMode="numeric" maxLength={9} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} placeholder={level === 6 ? "9 أرقام" : `كود المستوى ${level}`} /></label>
          <label>الحساب الأب
            <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— مستوى أول —</option>
              {possibleParents.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          {!selectedParent && <label>التصنيف<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
          {level === 6 && form.type === "asset" && <label className="checkbox-label"><input type="checkbox" checked={form.isBankOrCash} onChange={(e) => setForm({ ...form, isBankOrCash: e.target.checked })} />نقدي/بنكي</label>}
        </div>
        <div className="form-btn-group"><button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديل/النقل" : "إضافة الحساب"}</button>{editingId && <button className="btn-ghost" onClick={reset}>إلغاء</button>}<span className="note">المستوى {level} {level === 6 ? "— حساب حركة" : "— حساب تجميعي"}</span></div>
      </div>

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الكود</th><th>الحساب</th><th>المستوى</th><th>النوع</th><th>الرصيد</th><th>الإجراءات</th></tr></thead>
          <tbody>{rows.map((a) => {
            const hasChildren = (children.get(a.id) || []).length > 0;
            return <tr key={a.id} style={{ opacity: a.isArchived ? .55 : 1 }}>
              <td className="num">{a.code}</td>
              <td style={{ paddingRight: `${12 + (a.level - 1) * 24}px` }}><button className="icon-btn" disabled={!hasChildren} onClick={() => toggle(a.id)}>{hasChildren ? (expanded.has(a.id) ? "−" : "+") : "•"}</button> {a.name}</td>
              <td>{a.level}</td><td>{a.isPosting ? "حساب حركة" : "تجميعي"}</td><td className="num">{fmt(a.balance || 0)}</td>
              <td className="row-actions">
                {a.level < 6 && <button className="icon-btn" title="إضافة حساب فرعي" onClick={() => addChild(a)}>＋</button>}
                <button className="icon-btn" title="تعديل أو نقل الحساب" onClick={() => edit(a)}><Icon.Edit /></button>
                <button className="icon-btn" title={a.isArchived ? "إلغاء الأرشفة" : "أرشفة"} onClick={() => archive(a)}>▣</button>
                <button className="icon-btn icon-btn-danger" title="حذف" onClick={() => remove(a)}><Icon.Trash /></button>
              </td>
            </tr>;
          })}{rows.length === 0 && <tr><td colSpan={6} className="empty">لا توجد حسابات في هذه الشجرة.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
