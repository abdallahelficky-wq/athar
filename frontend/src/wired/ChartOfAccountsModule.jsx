import React, { useEffect, useState } from "react";
import { listAccounts, createAccount, updateAccount, deleteAccount } from "../api/accounts";
import { Icon } from "../legacy/shared";

const TYPE_LABEL = { asset: "أصول", liability: "التزامات", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات" };
const TYPES = ["asset", "liability", "equity", "revenue", "expense"];

export default function ChartOfAccountsModule() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", type: "asset", isBankOrCash: false });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", type: "asset", isBankOrCash: false });

  const reload = () => {
    setLoading(true);
    listAccounts()
      .then(setAccounts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const add = async () => {
    if (!form.name.trim()) return;
    try {
      await createAccount({ name: form.name.trim(), type: form.type, isBankOrCash: form.isBankOrCash });
      setForm({ name: "", type: "asset", isBankOrCash: false });
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (a) => { setEditingId(a.id); setEditForm({ name: a.name, type: a.type, isBankOrCash: a.isBankOrCash }); };

  const saveEdit = async () => {
    try {
      await updateAccount(editingId, editForm);
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`حذف حساب "${a.name}"؟`)) return;
    try {
      await deleteAccount(a.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const grouped = TYPES.map((t) => ({ type: t, accounts: accounts.filter((a) => a.type === t) }));

  if (loading) return <p className="empty">جارٍ التحميل...</p>;

  return (
    <div>
      {error && <p className="balance-bad">{error}</p>}
      <div className="panel form-panel">
        <div className="form-grid">
          <label>اسم الحساب
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: مصروف صيانة معدات" />
          </label>
          <label>التصنيف
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {form.type === "asset" && (
            <label className="checkbox-label">
              <input type="checkbox" checked={form.isBankOrCash} onChange={(e) => setForm({ ...form, isBankOrCash: e.target.checked })} />
              حساب نقدي/بنكي (يظهر في توزيع الكاش بالداشبورد)
            </label>
          )}
        </div>
        <button className="btn-primary" onClick={add}>إضافة حساب جديد</button>
      </div>

      {grouped.map((g) => (
        <div className="panel" key={g.type}>
          <h3>{TYPE_LABEL[g.type]}</h3>
          <table className="ledger-table">
            <tbody>
              {g.accounts.map((a) => (
                <tr key={a.id}>
                  {editingId === a.id ? (
                    <>
                      <td><input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                      <td>
                        <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td>
                        {editForm.type === "asset" && (
                          <label className="checkbox-label">
                            <input type="checkbox" checked={editForm.isBankOrCash} onChange={(e) => setEditForm({ ...editForm, isBankOrCash: e.target.checked })} />
                            نقدي/بنكي
                          </label>
                        )}
                      </td>
                      <td className="row-actions">
                        <button className="btn-ghost" onClick={saveEdit}>حفظ</button>
                        <button className="btn-ghost" onClick={() => setEditingId(null)}>إلغاء</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{a.name}</td><td></td>
                      <td>{a.isBankOrCash && <span className="status-badge">نقدي/بنكي</span>}</td>
                      <td className="row-actions">
                        <button className="icon-btn" title="تعديل" onClick={() => startEdit(a)}><Icon.Edit /></button>
                        <button className="icon-btn icon-btn-danger" title="حذف" onClick={() => remove(a)}><Icon.Trash /></button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {g.accounts.length === 0 && <tr><td className="empty">لا توجد حسابات بهذا التصنيف</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
