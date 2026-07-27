import React, { useEffect, useState } from "react";
import { listFixedAssets, createFixedAsset, updateFixedAsset, removeFixedAsset } from "../../api/fixedAssets";
import { ASSET_CATEGORIES, fmt } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";

const emptyForm = () => ({ name: "", category: ASSET_CATEGORIES[0], purchaseDate: new Date().toISOString().slice(0, 10), cost: "", usefulLifeYears: "5", salvageValue: "0", paymentMethod: "cash" });

export default function AssetRegisterTab({ companyId }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listFixedAssets(companyId).then(setAssets).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.name || !Number(form.cost)) return;
    try {
      if (editingId) {
        await updateFixedAsset(editingId, { name: form.name, category: form.category, usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue) });
      } else {
        await createFixedAsset({
          companyId, name: form.name, category: form.category, purchaseDate: form.purchaseDate,
          cost: Number(form.cost), usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue), paymentMethod: form.paymentMethod,
        });
      }
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    setForm({ ...emptyForm(), name: a.name, category: a.category || ASSET_CATEGORIES[0], usefulLifeYears: a.usefulLifeYears, salvageValue: a.salvageValue });
  };

  const doRemove = async (pin) => {
    await removeFixedAsset(removeTarget.id, pin);
    setRemoveTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل الأصل — {form.name} (لا يمكن تعديل التكلفة أو تاريخ الشراء بعد الترحيل)</div>}
        <div className="form-grid">
          <label>اسم الأصل<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>التصنيف<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          {!editingId && <label>تاريخ الشراء<input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></label>}
          {!editingId && <label>التكلفة<input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label>}
          <label>العمر الإنتاجي (سنوات)<input type="number" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} /></label>
          <label>القيمة التخريدية<input type="number" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} /></label>
          {!editingId && (
            <label>طريقة السداد
              <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                <option value="cash">نقدي</option><option value="bank">بنكي</option><option value="credit">آجل (ذمم دائنة)</option>
              </select>
            </label>
          )}
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>إلغاء</button>}
          <button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ الأصل وترحيل الشراء"}</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الأصل</th><th>التصنيف</th><th>تاريخ الشراء</th><th>التكلفة</th><th>مجمع الإهلاك</th><th>صافي القيمة الدفترية</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <React.Fragment key={a.id}>
                  <tr>
                    <td>{a.name}</td><td>{a.category}</td><td>{a.purchaseDate.slice(0, 10)}</td>
                    <td className="num">{fmt(a.cost)}</td><td className="num">{fmt(a.accumulatedDepreciation)}</td>
                    <td className="num strong">{fmt(a.netBookValue)}</td>
                    <td><span className="status-badge">{a.status === "disposed" ? "مستبعد" : "نشط"}</span></td>
                    <td className="row-actions">
                      {a.status !== "disposed" && (
                        <>
                          <button className="btn-ghost" onClick={() => startEdit(a)}>تعديل</button>
                          <button className="btn-ghost" onClick={() => setRemoveTarget(a)}>حذف</button>
                        </>
                      )}
                      <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === a.id ? null : a.id)}>
                        {attachmentsFor === a.id ? "إخفاء المرفقات" : "المرفقات"}
                      </button>
                    </td>
                  </tr>
                  {attachmentsFor === a.id && (
                    <tr><td colSpan={8}><AttachmentsPanel entityType="fixed_asset" entityId={a.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {assets.length === 0 && <tr><td className="empty" colSpan={8}>لا توجد أصول ثابتة مسجّلة بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {removeTarget && <UnpostModal title="حذف الأصل" onCancel={() => setRemoveTarget(null)} onConfirm={doRemove} />}
    </div>
  );
}
