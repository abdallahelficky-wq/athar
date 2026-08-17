import React, { useEffect, useState } from "react";
import { listFixedAssets, createFixedAsset, updateFixedAsset, removeFixedAsset } from "../../api/fixedAssets";
import { listAccounts } from "../../api/accounts";
import { listCostCenters } from "../../api/costCenters";
import { ASSET_CATEGORIES, fmt } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import AccountSearchSelect from "../shared/AccountSearchSelect";

// رقم الهيكل مفيد فقط لفئة "سيارات ومركبات" تحديداً — يُخفى لباقي التصنيفات بدل إرباك الفورم بحقل
// لا علاقة له بأغلب الأصول.
const VEHICLE_CATEGORY = "سيارات ومركبات";

const emptyForm = () => ({
  accountId: "", name: "", category: ASSET_CATEGORIES[0], serialNumber: "", chassisNumber: "", costCenterId: "",
  purchaseDate: new Date().toISOString().slice(0, 10), cost: "", usefulLifeYears: "5", salvageValue: "0",
  isDepreciable: true, paymentMethod: "cash",
});

export default function AssetRegisterTab({ companyId }) {
  const [assets, setAssets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
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
  useEffect(() => {
    if (!companyId) return;
    listAccounts({ companyId }).then(setAccounts).catch((e) => setError(e.message));
    listCostCenters().then(setCostCenters).catch((e) => setError(e.message));
  }, [companyId]);

  // حسابات أصول قابلة للترحيل فقط — هذه الشاشة مخصَّصة للأصول الثابتة فعلياً، فلا حاجة لتقييدها
  // بعلامة isFixedAssetAccount (تلك العلامة لتفعيل نافذة الاختيار من داخل قيد يومي عام، Phase C/F).
  const assetAccounts = accounts.filter((a) => a.type === "asset");
  const companyCostCenters = costCenters.filter((c) => !c.companyId || c.companyId === companyId);

  const save = async () => {
    if (!form.name || !Number(form.cost) || !form.accountId) return;
    try {
      if (editingId) {
        await updateFixedAsset(editingId, {
          accountId: form.accountId, name: form.name, category: form.category,
          serialNumber: form.serialNumber || undefined, chassisNumber: form.chassisNumber || undefined,
          costCenterId: form.costCenterId || undefined,
          usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue), isDepreciable: form.isDepreciable,
        });
      } else {
        await createFixedAsset({
          companyId, accountId: form.accountId, name: form.name, category: form.category,
          serialNumber: form.serialNumber || undefined, chassisNumber: form.chassisNumber || undefined,
          costCenterId: form.costCenterId || undefined, purchaseDate: form.purchaseDate,
          cost: Number(form.cost), usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue),
          isDepreciable: form.isDepreciable, paymentMethod: form.paymentMethod,
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
    setForm({
      ...emptyForm(), accountId: a.accountId || "", name: a.name, category: a.category || ASSET_CATEGORIES[0],
      serialNumber: a.serialNumber || "", chassisNumber: a.chassisNumber || "", costCenterId: a.costCenterId || "",
      usefulLifeYears: a.usefulLifeYears, salvageValue: a.salvageValue, isDepreciable: a.isDepreciable,
    });
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
          <label>الحساب المحاسبي
            <AccountSearchSelect accounts={assetAccounts} value={form.accountId} onChange={(accountId) => setForm({ ...form, accountId })} />
          </label>
          <label>الرقم التسلسلي (اختياري)<input type="text" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></label>
          {form.category === VEHICLE_CATEGORY && (
            <label>رقم الهيكل<input type="text" value={form.chassisNumber} onChange={(e) => setForm({ ...form, chassisNumber: e.target.value })} /></label>
          )}
          <label>الموقع/الفرع (اختياري)
            <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
              <option value="">— بلا —</option>
              {companyCostCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {!editingId && <label>تاريخ الشراء<input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></label>}
          {!editingId && <label>التكلفة<input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label>}
          <label>العمر الإنتاجي (سنوات)<input type="number" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} /></label>
          <label>القيمة التخريدية<input type="number" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.isDepreciable} onChange={(e) => setForm({ ...form, isDepreciable: e.target.checked })} />يُستهلك (أوقف التفعيل للأراضي مثلاً)</label>
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
            <thead><tr><th>رقم الأصل</th><th>الأصل</th><th>التصنيف</th><th>تاريخ الشراء</th><th>التكلفة</th><th>مجمع الإهلاك</th><th>صافي القيمة الدفترية</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <React.Fragment key={a.id}>
                  <tr>
                    <td className="num">{a.assetNumber}</td>
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
                    <tr><td colSpan={9}><AttachmentsPanel entityType="fixed_asset" entityId={a.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {assets.length === 0 && <tr><td className="empty" colSpan={9}>لا توجد أصول ثابتة مسجّلة بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {removeTarget && <UnpostModal title="حذف الأصل" onCancel={() => setRemoveTarget(null)} onConfirm={doRemove} />}
    </div>
  );
}
