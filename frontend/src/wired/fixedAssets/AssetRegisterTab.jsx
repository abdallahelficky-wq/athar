import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listFixedAssets, createFixedAsset, updateFixedAsset, removeFixedAsset } from "../../api/fixedAssets";
import { listAccounts } from "../../api/accounts";
import { listCostCenters } from "../../api/costCenters";
import { listAssetCategories } from "../../api/assetCategories";
import { listEmployees } from "../../api/employees";
import { ASSET_CATEGORIES, fmt } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import AccountSearchSelect from "../shared/AccountSearchSelect";
import EmployeeSearchSelect from "../shared/EmployeeSearchSelect";
import AssetCardPrintModal from "./AssetCardPrintModal";

// رقم الهيكل ورقم اللوحة مفيدان فقط لفئة "سيارات ومركبات" تحديداً — يُخفَيان لباقي التصنيفات بدل
// إرباك الفورم بحقول لا علاقة لها بأغلب الأصول.
const VEHICLE_CATEGORY = "سيارات ومركبات";

const emptyForm = () => ({
  categoryId: "", useRawAccount: false, accountId: "",
  name: "", category: ASSET_CATEGORIES[0], serialNumber: "", chassisNumber: "", plateNumber: "", costCenterId: "",
  custodianEmployeeId: "",
  purchaseDate: new Date().toISOString().slice(0, 10), depreciationStartDate: "",
  cost: "", usefulLifeYears: "5", salvageValue: "0", depreciationMethod: "straight_line",
  isDepreciable: true, paymentMethod: "cash",
});

export default function AssetRegisterTab({ companyId, companies }) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [printCardFor, setPrintCardFor] = useState(null);

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
    listAssetCategories(companyId).then(setCategories).catch((e) => setError(e.message));
    listEmployees(companyId).then(setEmployees).catch((e) => setError(e.message));
  }, [companyId]);

  // حسابات أصول قابلة للترحيل فقط — هذه الشاشة مخصَّصة للأصول الثابتة فعلياً، فلا حاجة لتقييدها
  // بعلامة isFixedAssetAccount (تلك العلامة لتفعيل نافذة الاختيار من داخل قيد يومي عام، Phase F).
  const assetAccounts = accounts.filter((a) => a.type === "asset");
  const companyCostCenters = costCenters.filter((c) => !c.companyId || c.companyId === companyId);
  const groupedCategories = categories.reduce((acc, c) => {
    (acc[c.groupName] = acc[c.groupName] || []).push(c);
    return acc;
  }, {});
  const annualDepreciationRate = Number(form.usefulLifeYears) > 0 ? (100 / Number(form.usefulLifeYears)).toFixed(2) : null;

  const save = async () => {
    if (!form.name || !Number(form.cost)) return;
    if (!form.categoryId && !(form.useRawAccount && form.accountId)) return;
    const shared = {
      name: form.name, category: form.category,
      serialNumber: form.serialNumber || undefined, chassisNumber: form.chassisNumber || undefined,
      plateNumber: form.plateNumber || undefined,
      costCenterId: form.costCenterId || undefined,
      depreciationStartDate: form.depreciationStartDate || undefined,
      usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue),
      depreciationMethod: form.depreciationMethod, isDepreciable: form.isDepreciable,
      ...(form.useRawAccount ? { accountId: form.accountId } : { categoryId: form.categoryId }),
    };
    try {
      if (editingId) {
        // null صراحةً هنا (بعكس الإنشاء) لأن التعديل يجب أن يقدر يُزيل عهدة موظف موجودة، لا فقط يتجاهلها.
        await updateFixedAsset(editingId, { ...shared, custodianEmployeeId: form.custodianEmployeeId || null });
      } else {
        await createFixedAsset({
          companyId, purchaseDate: form.purchaseDate, cost: Number(form.cost), paymentMethod: form.paymentMethod,
          custodianEmployeeId: form.custodianEmployeeId || undefined, ...shared,
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
      ...emptyForm(),
      categoryId: a.categoryId || "", useRawAccount: !a.categoryId, accountId: a.accountId || "",
      name: a.name, category: a.category || ASSET_CATEGORIES[0],
      serialNumber: a.serialNumber || "", chassisNumber: a.chassisNumber || "", plateNumber: a.plateNumber || "",
      costCenterId: a.costCenterId || "", custodianEmployeeId: a.custodianEmployeeId || "",
      depreciationStartDate: a.depreciationStartDate ? a.depreciationStartDate.slice(0, 10) : "",
      usefulLifeYears: a.usefulLifeYears, salvageValue: a.salvageValue,
      depreciationMethod: a.depreciationMethod || "straight_line", isDepreciable: a.isDepreciable,
    });
  };

  const doRemove = async (pin) => {
    await removeFixedAsset(removeTarget.id, pin);
    setRemoveTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">{t("fixedAssets.register.editingBanner", { name: form.name })}</div>}
        <div className="form-grid">
          <label>{t("fixedAssets.register.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("fixedAssets.register.category")}<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          {!form.useRawAccount ? (
            <label>{t("fixedAssets.register.assetCategory")}
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">{t("fixedAssets.register.chooseCategory")}</option>
                {Object.entries(groupedCategories).map(([groupName, items]) => (
                  <optgroup key={groupName} label={groupName}>
                    {items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : (
            <label>{t("fixedAssets.register.account")}
              <AccountSearchSelect accounts={assetAccounts} value={form.accountId} onChange={(accountId) => setForm({ ...form, accountId })} />
            </label>
          )}
          <label className="checkbox-label">
            <input type="checkbox" checked={form.useRawAccount} onChange={(e) => setForm({ ...form, useRawAccount: e.target.checked })} />
            {t("fixedAssets.register.useRawAccount")}
          </label>
          <label>{t("fixedAssets.register.serialNumber")}<input type="text" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></label>
          {form.category === VEHICLE_CATEGORY && (
            <>
              <label>{t("fixedAssets.register.chassisNumber")}<input type="text" value={form.chassisNumber} onChange={(e) => setForm({ ...form, chassisNumber: e.target.value })} /></label>
              <label>{t("fixedAssets.register.plateNumber")}<input type="text" value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} /></label>
            </>
          )}
          <label>{t("fixedAssets.register.costCenter")}
            <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
              <option value="">{t("fixedAssets.register.none")}</option>
              {companyCostCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t("fixedAssets.register.custodian")}
            <EmployeeSearchSelect employees={employees} value={form.custodianEmployeeId} onChange={(id) => setForm({ ...form, custodianEmployeeId: id })} allowClear clearLabel={t("fixedAssets.register.none")} />
          </label>
          {!editingId && <label>{t("fixedAssets.register.purchaseDate")}<input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></label>}
          {!editingId && <label>{t("fixedAssets.register.cost")}<input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label>}
          <label>{t("fixedAssets.register.depreciationStartDate")}<input type="date" value={form.depreciationStartDate} onChange={(e) => setForm({ ...form, depreciationStartDate: e.target.value })} /></label>
          <label>{t("fixedAssets.register.usefulLifeYears")}<input type="number" step="0.1" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} /></label>
          <label>{t("fixedAssets.register.annualDepreciationRate")}<input type="text" value={annualDepreciationRate ? `${annualDepreciationRate}%` : "—"} disabled /></label>
          <label>{t("fixedAssets.register.depreciationMethodLabel")}
            <select value={form.depreciationMethod} onChange={(e) => setForm({ ...form, depreciationMethod: e.target.value })}>
              <option value="straight_line">{t("fixedAssets.depreciationMethod.straight_line")}</option>
              <option value="declining_balance" disabled>{t("fixedAssets.register.decliningSoon")}</option>
            </select>
          </label>
          <label>{t("fixedAssets.register.salvageValue")}<input type="number" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.isDepreciable} onChange={(e) => setForm({ ...form, isDepreciable: e.target.checked })} />{t("fixedAssets.register.isDepreciable")}</label>
          {!editingId && (
            <label>{t("fixedAssets.register.paymentMethod")}
              <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                <option value="cash">{t("fixedAssets.register.paymentCash")}</option><option value="bank">{t("fixedAssets.register.paymentBank")}</option><option value="credit">{t("fixedAssets.register.paymentCredit")}</option>
              </select>
            </label>
          )}
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>{t("fixedAssets.register.cancel")}</button>}
          <button className="btn-primary" onClick={save}>{editingId ? t("fixedAssets.register.saveChanges") : t("fixedAssets.register.saveAsset")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("fixedAssets.register.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("fixedAssets.register.table.assetNumber")}</th><th>{t("fixedAssets.register.table.asset")}</th><th>{t("fixedAssets.register.table.category")}</th><th>{t("fixedAssets.register.table.purchaseDate")}</th><th>{t("fixedAssets.register.table.cost")}</th><th>{t("fixedAssets.register.table.accumulatedDepreciation")}</th><th>{t("fixedAssets.register.table.netBookValue")}</th><th>{t("fixedAssets.register.table.status")}</th><th></th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <React.Fragment key={a.id}>
                  <tr>
                    <td className="num">{a.assetNumber}</td>
                    <td>{a.name}</td><td>{a.category}</td><td>{a.purchaseDate.slice(0, 10)}</td>
                    <td className="num">{fmt(a.cost)}</td><td className="num">{fmt(a.accumulatedDepreciation)}</td>
                    <td className="num strong">{fmt(a.netBookValue)}</td>
                    <td><span className="status-badge">{a.status === "disposed" ? t("fixedAssets.status.disposed") : t("fixedAssets.status.active")}</span></td>
                    <td className="row-actions">
                      {a.status !== "disposed" && (
                        <>
                          <button className="btn-ghost" onClick={() => startEdit(a)}>{t("fixedAssets.register.edit")}</button>
                          <button className="btn-ghost" onClick={() => setRemoveTarget(a)}>{t("fixedAssets.register.delete")}</button>
                        </>
                      )}
                      <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === a.id ? null : a.id)}>
                        {attachmentsFor === a.id ? t("fixedAssets.register.attachmentsHide") : t("fixedAssets.register.attachmentsShow")}
                      </button>
                      <button className="btn-ghost" onClick={() => setPrintCardFor(a)}>{t("fixedAssets.register.printCard")}</button>
                    </td>
                  </tr>
                  {attachmentsFor === a.id && (
                    <tr><td colSpan={9}><AttachmentsPanel entityType="fixed_asset" entityId={a.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {assets.length === 0 && <tr><td className="empty" colSpan={9}>{t("fixedAssets.register.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {removeTarget && <UnpostModal title={t("fixedAssets.register.deleteTitle")} onCancel={() => setRemoveTarget(null)} onConfirm={doRemove} />}
      {printCardFor && (
        <AssetCardPrintModal
          asset={printCardFor}
          companies={companies}
          employees={employees}
          costCenters={companyCostCenters}
          onClose={() => setPrintCardFor(null)}
        />
      )}
    </div>
  );
}
