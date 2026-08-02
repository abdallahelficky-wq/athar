import React, { useEffect, useMemo, useState } from "react";
import { listAccounts, getNextAccountCode, createAccount, updateAccount, deleteAccount, installStandardChart } from "../api/accounts";
import { fmt } from "../legacy/constants";
import { Icon } from "../legacy/shared";
import { useAuth } from "../context/AuthContext";
import AccountImportPanel from "./AccountImportPanel";

const TYPE_LABEL = { asset: "أصول", liability: "التزامات", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات" };
const emptyForm = { name: "", nameEn: "", code: "", type: "asset", parentId: "", isPosting: false, isBankOrCash: false };

export default function ChartOfAccountsModule({ companies = [], companyId }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [scope, setScope] = useState(companyId || "group");
  const [accounts, setAccounts] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [compact, setCompact] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => { if (companyId) setScope(companyId); }, [companyId]);
  const reload = () => listAccounts({ tree: true, companyId: scope === "group" ? undefined : scope })
    .then((rows) => { setAccounts(rows); setExpanded(new Set(rows.filter((a) => a.level < 4).map((a) => a.id))); setError(""); })
    .catch((err) => setError(err.message));
  useEffect(() => { reload(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedParent = accounts.find((a) => a.id === form.parentId);
  const level = selectedParent ? selectedParent.level + 1 : 1;
  const editingAccount = accounts.find((a) => a.id === editingId);
  const possibleParents = accounts.filter((a) => !a.isPosting && !a.isArchived && a.level < 4 && a.id !== editingId
    && (!editingAccount || a.level === editingAccount.level - 1));
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
    setError("");
    setSuccess("");
    if (form.name.trim().length < 2) return setError("أدخل اسم الحساب بالعربية (حرفان على الأقل).");
    if (!form.code.trim()) return setError("أدخل كود الحساب.");
    if (level > 1 && !form.parentId) return setError("اختر الحساب الأب للمستوى المطلوب.");
    if (level === 4 && !/^\d{9}$/.test(form.code)) return setError("كود حساب المستوى الرابع يجب أن يتكون من 9 أرقام.");
    const payload = {
      ...form,
      name: form.name.trim(), nameEn: form.nameEn.trim() || null, code: form.code.trim(), parentId: form.parentId || null,
      companyId: scope === "group" ? null : scope, level,
      type: selectedParent?.type || form.type,
    };
    try {
      setSaving(true);
      if (editingId) {
        try {
          await updateAccount(editingId, payload);
        } catch (err) {
          if (!err.details?.requiresMoveConfirmation || !window.confirm(`${err.message}\n\nهل تريد متابعة النقل مع الإبقاء على الكود الحالي؟`)) throw err;
          await updateAccount(editingId, { ...payload, confirmMoveWithTransactions: true });
        }
      } else await createAccount(payload);
      const message = editingId ? "تم حفظ تعديلات الحساب بنجاح." : "تمت إضافة الحساب بنجاح.";
      reset();
      await reload();
      setSuccess(message);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  const edit = (a) => { setEditingId(a.id); setForm({ name: a.name, nameEn: a.nameEn || "", code: a.code, type: a.type, parentId: a.parentId || "", isPosting: a.isPosting, isBankOrCash: a.isBankOrCash }); };
  const addChild = async (a) => {
    setEditingId(null); setError(""); setSuccess("");
    try {
      const { code } = await getNextAccountCode(a.id, scope === "group" ? undefined : scope);
      setForm({ ...emptyForm, type: a.type, parentId: a.id, code, isPosting: a.level === 3 });
    } catch (err) { setError(err.message); }
  };
  const selectParent = async (parentId) => {
    if (editingId || !parentId) return setForm((current) => ({ ...current, parentId, code: parentId ? current.code : "", isPosting: false }));
    const parent = accounts.find((account) => account.id === parentId);
    setError("");
    try {
      const { code } = await getNextAccountCode(parentId, scope === "group" ? undefined : scope);
      setForm((current) => ({ ...current, parentId, code, type: parent?.type || current.type, isPosting: parent?.level === 3 }));
    } catch (err) { setError(err.message); }
  };
  const archive = async (a) => {
    setError(""); setSuccess("");
    try { await updateAccount(a.id, { isArchived: !a.isArchived }); await reload(); setSuccess(a.isArchived ? "تم إلغاء أرشفة الحساب." : "تمت أرشفة الحساب."); }
    catch (err) { setError(err.message); }
  };
  const remove = async (a) => {
    if (!window.confirm(`حذف حساب "${a.name}"؟`)) return;
    try { await deleteAccount(a.id); await reload(); setSuccess("تم حذف الحساب."); } catch (err) { setError(err.message); }
  };
  const toggle = (id) => setExpanded((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const installStandard = async () => {
    const scopeName = scope === "group" ? "شجرة المجموعة وجميع حركات المستأجر التجريبية" : "شجرة الشركة وحركاتها التجريبية";
    if (!window.confirm(`سيتم حذف ${scopeName} ثم تثبيت الشجرة القياسية. لا يمكن التراجع عن هذا الإجراء. هل تريد المتابعة؟`)) return;
    const confirmation = window.prompt("للتأكيد اكتب كلمة: تثبيت");
    if (confirmation !== "تثبيت") return;
    setInstalling(true);
    setError("");
    try {
      const result = await installStandardChart({
        companyId: scope === "group" ? null : scope,
        confirmation: "INSTALL_STANDARD_CHART",
      });
      reset();
      await reload();
      window.alert(`تم تثبيت ${result.installedAccounts} حسابًا قياسيًا وحذف ${result.deletedAccounts} حسابًا قديمًا.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div>
      {error && <p className="balance-bad">{error}</p>}
      {success && <p className="balance-good">{success}</p>}
      <div className="panel form-panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
          <label>نطاق الشجرة
            <select value={scope} onChange={(e) => { setScope(e.target.value); reset(); }}>
              <option value="group">قالب المجموعة (غير مستخدم في القيود)</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
            </select>
          </label>
          <div className="form-btn-group">
            <button className="btn-ghost" onClick={() => setCompact((v) => !v)}>{compact ? "عرض الشجرة كاملة" : "عرض مصغّر"}</button>
            {isSuperAdmin && (
              <button className="btn-ghost" style={{ color: "#A8432B", borderColor: "rgba(168,67,43,0.35)" }} disabled={installing} onClick={installStandard}>
                {installing ? "جارٍ تثبيت الشجرة..." : "تثبيت الشجرة القياسية"}
              </button>
            )}
          </div>
        </div>
        <div className="form-grid">
          <label>اسم الحساب بالعربية<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>اسم الحساب بالإنجليزية (اختياري)<input dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
          <label>كود الحساب<input inputMode="numeric" maxLength={9} readOnly={Boolean(editingId)} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} placeholder={level === 4 ? "يُولّد تلقائياً من الحساب الأب" : `كود المستوى ${level}`} /></label>
          <label>الحساب الأب
            <select value={form.parentId} onChange={(e) => selectParent(e.target.value)}>
              <option value="">— مستوى أول —</option>
              {possibleParents.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          {!selectedParent && <label>التصنيف<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
          {level === 4 && <label className="checkbox-label"><input type="checkbox" checked readOnly />حساب ترحيل</label>}
          {form.isPosting && form.type === "asset" && <label className="checkbox-label"><input type="checkbox" checked={form.isBankOrCash} onChange={(e) => setForm({ ...form, isBankOrCash: e.target.checked })} />نقدي/بنكي</label>}
        </div>
        <div className="form-btn-group"><button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? "جارٍ الحفظ..." : editingId ? "حفظ التعديل/النقل" : "إضافة الحساب"}</button>{editingId && <button type="button" className="btn-ghost" onClick={reset}>إلغاء</button>}<span className="note">المستوى {level} من 4 — {level === 4 ? "حساب ترحيل تلقائياً" : "حساب تجميعي"}. عند النقل يبقى الكود ثابتاً لحماية أثر المراجعة التاريخي.</span></div>
      </div>

      <AccountImportPanel scope={scope} accounts={accounts} onImported={reload} />

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الكود</th><th>الحساب</th><th>المستوى</th><th>النوع</th><th>الرصيد</th><th>الإجراءات</th></tr></thead>
          <tbody>{rows.map((a) => {
            const hasChildren = (children.get(a.id) || []).length > 0;
            return <tr key={a.id} style={{ opacity: a.isArchived ? .55 : 1 }}>
              <td className="num">{a.code}</td>
              <td style={{ paddingRight: `${12 + (a.level - 1) * 24}px` }}><button className="icon-btn" disabled={!hasChildren} onClick={() => toggle(a.id)}>{hasChildren ? (expanded.has(a.id) ? "−" : "+") : "•"}</button> {a.name}{a.nameEn && <small style={{ display: "block", direction: "ltr", color: "#6b7280" }}>{a.nameEn}</small>}</td>
              <td>{a.level}</td><td>{a.isPosting ? "حساب حركة" : "تجميعي"}</td><td className="num">{fmt(a.balance || 0)}</td>
              <td className="row-actions">
                {!a.isPosting && a.level < 4 && <button type="button" className="icon-btn" title="إضافة حساب فرعي" onClick={() => addChild(a)}>＋</button>}
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
