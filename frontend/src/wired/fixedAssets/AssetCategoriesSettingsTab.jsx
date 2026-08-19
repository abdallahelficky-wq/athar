import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../../api/accounts";
import { listAssetCategories, createAssetCategory, updateAssetCategory, removeAssetCategory } from "../../api/assetCategories";
import AccountSearchSelect from "../shared/AccountSearchSelect";

const emptyForm = () => ({ groupName: "", name: "", assetAccountId: "", accumulatedDepreciationAccountId: "", depreciationExpenseAccountId: "" });

/**
 * شاشة "إعدادات الأصول الثابتة" — تُعرِّف فئات الأصول (مجموعة عرض + فئة تحمل ثلاثة حسابات: اقتناء،
 * مجمع إهلاك، مصروف إهلاك). اختيار فئة عند تسجيل أصل جديد (AssetRegisterTab) يشتق حساباته الثلاثة
 * تلقائياً بدل اختيار حساب خام يدوياً في كل مرة، ويُفعِّل isFixedAssetAccount تلقائياً على حساب
 * الاقتناء (لتنشيط نافذة "أصل جديد/موجود" عند اختياره داخل قيد يومية عام لاحقاً، Phase F).
 */
export default function AssetCategoriesSettingsTab({ companyId }) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");

  const reload = () => {
    if (!companyId) return;
    listAssetCategories(companyId).then(setCategories).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId]);
  useEffect(() => { if (companyId) listAccounts({ companyId }).then(setAccounts); }, [companyId]);

  const postingAccounts = useMemo(() => accounts.filter((a) => a.isPosting && a.isActive && !a.isArchived), [accounts]);
  const assetAccounts = useMemo(() => postingAccounts.filter((a) => a.type === "asset"), [postingAccounts]);
  const expenseAccounts = useMemo(() => postingAccounts.filter((a) => a.type === "expense"), [postingAccounts]);

  const groups = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => {
      if (!map.has(c.groupName)) map.set(c.groupName, []);
      map.get(c.groupName).push(c);
    });
    return [...map.entries()];
  }, [categories]);

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setFormOpen(true); };
  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({
      groupName: c.groupName, name: c.name, assetAccountId: c.assetAccountId,
      accumulatedDepreciationAccountId: c.accumulatedDepreciationAccountId, depreciationExpenseAccountId: c.depreciationExpenseAccountId,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.groupName.trim() || !form.name.trim() || !form.assetAccountId || !form.accumulatedDepreciationAccountId || !form.depreciationExpenseAccountId) {
      setError(t("fixedAssets.categories.errAllFieldsRequired"));
      return;
    }
    const payload = { groupName: form.groupName.trim(), name: form.name.trim(), assetAccountId: form.assetAccountId, accumulatedDepreciationAccountId: form.accumulatedDepreciationAccountId, depreciationExpenseAccountId: form.depreciationExpenseAccountId };
    try {
      if (editingId) await updateAssetCategory(editingId, payload);
      else await createAssetCategory({ companyId, ...payload });
      setFormOpen(false); setError("");
      reload();
    } catch (err) { setError(err.message); }
  };

  const remove = async (c) => {
    if (!window.confirm(t("fixedAssets.categories.confirmDelete", { name: c.name }))) return;
    try { await removeAssetCategory(c.id); reload(); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      {error && <p className="balance-bad">{error}</p>}

      <div className="panel">
        <div className="items-form-heading"><strong>{t("fixedAssets.categories.title")}</strong><button className="btn-primary" onClick={openNew}>{t("fixedAssets.categories.newCategory")}</button></div>
        {groups.map(([groupName, items]) => (
          <div key={groupName} style={{ marginBottom: 16 }}>
            <h3 className="sub-head">{groupName}</h3>
            <div className="lines-table-wrap">
              <table className="lines-table">
                <thead><tr><th>{t("fixedAssets.categories.table.category")}</th><th>{t("fixedAssets.categories.table.assetAccount")}</th><th>{t("fixedAssets.categories.table.accumulatedDepreciationAccount")}</th><th>{t("fixedAssets.categories.table.depreciationExpenseAccount")}</th><th></th></tr></thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.assetAccount?.code} — {c.assetAccount?.name}</td>
                      <td>{c.accumulatedDepreciationAccount?.code} — {c.accumulatedDepreciationAccount?.name}</td>
                      <td>{c.depreciationExpenseAccount?.code} — {c.depreciationExpenseAccount?.name}</td>
                      <td className="row-actions">
                        <button className="btn-ghost" onClick={() => startEdit(c)}>{t("fixedAssets.categories.edit")}</button>
                        <button className="btn-ghost" onClick={() => remove(c)}>{t("fixedAssets.categories.delete")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {categories.length === 0 && <p className="empty">{t("fixedAssets.categories.empty")}</p>}
      </div>

      {formOpen && (
        <div className="panel form-panel">
          <div className="items-form-heading"><strong>{editingId ? t("fixedAssets.categories.formTitleEdit", { name: form.name }) : t("fixedAssets.categories.formTitleCreate")}</strong><button className="item-close" onClick={() => setFormOpen(false)}>×</button></div>
          <div className="form-grid">
            <label>{t("fixedAssets.categories.groupName")}<input type="text" value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} placeholder={t("fixedAssets.categories.groupNamePlaceholder")} /></label>
            <label>{t("fixedAssets.categories.categoryName")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("fixedAssets.categories.categoryNamePlaceholder")} /></label>
            <label>{t("fixedAssets.categories.assetAccount")}<AccountSearchSelect accounts={assetAccounts} value={form.assetAccountId} onChange={(id) => setForm({ ...form, assetAccountId: id })} /></label>
            <label>{t("fixedAssets.categories.accumulatedDepreciationAccount")}<AccountSearchSelect accounts={assetAccounts} value={form.accumulatedDepreciationAccountId} onChange={(id) => setForm({ ...form, accumulatedDepreciationAccountId: id })} /></label>
            <label>{t("fixedAssets.categories.depreciationExpenseAccount")}<AccountSearchSelect accounts={expenseAccounts} value={form.depreciationExpenseAccountId} onChange={(id) => setForm({ ...form, depreciationExpenseAccountId: id })} /></label>
          </div>
          <div className="form-btn-group"><button className="btn-ghost" onClick={() => setFormOpen(false)}>{t("fixedAssets.categories.cancel")}</button><button className="btn-primary" onClick={save}>{editingId ? t("fixedAssets.categories.saveChanges") : t("fixedAssets.categories.saveCategory")}</button></div>
        </div>
      )}
    </div>
  );
}
