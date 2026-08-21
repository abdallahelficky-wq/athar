import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listBranches, createBranch, updateBranch, deleteBranch } from "../api/branches";
import { COUNTRIES, CURRENCIES, countryName, currencyLabel, defaultCurrencyForCountry } from "../shared/countries";

const emptyForm = () => ({ nameAr: "", nameEn: "", country: "SA", currency: "SAR", exchangeRateToCompanyCurrency: "" });

/**
 * فروع الشركة — كل فرع بدولته وعملته الخاصتين (طبقة تصنيف/عرض فوق الشركة، بنفس مبدأ مركز
 * التكلفة/القسم)، مع سعر صرف يدوي اختياري لعرض القيمة المعادلة بجانب المبلغ الأصلي في القيود/
 * الفواتير المرتبطة بهذا الفرع. الحذف النهائي مرفوض من الخادم لو الفرع مرتبط بأي قيد/فاتورة
 * سابقة — البديل الصحيح تعطيله (isActive) لا حذفه.
 */
export default function BranchesPanel({ companyId, companyCurrency }) {
  const { t, i18n } = useTranslation();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const reload = () => {
    setLoading(true);
    listBranches(companyId).then(setBranches).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const onCountryChange = (value) => {
    setForm((prev) => ({ ...prev, country: value, currency: defaultCurrencyForCountry(value) }));
  };

  const save = async () => {
    if (!form.nameAr.trim() || !form.country || !form.currency) { setError(t("settings.branches.errRequired")); return; }
    setError("");
    try {
      const payload = {
        companyId,
        nameAr: form.nameAr.trim(),
        nameEn: form.nameEn.trim() || undefined,
        country: form.country,
        currency: form.currency,
        exchangeRateToCompanyCurrency: form.exchangeRateToCompanyCurrency ? Number(form.exchangeRateToCompanyCurrency) : null,
      };
      if (editingId) await updateBranch(editingId, payload);
      else await createBranch(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (b) => {
    setEditingId(b.id);
    setForm({
      nameAr: b.nameAr, nameEn: b.nameEn || "", country: b.country, currency: b.currency,
      exchangeRateToCompanyCurrency: b.exchangeRateToCompanyCurrency ?? "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const toggleActive = async (b) => {
    try { await updateBranch(b.id, { isActive: !b.isActive }); reload(); } catch (err) { setError(err.message); }
  };

  const remove = async (b) => {
    if (!window.confirm(t("settings.branches.confirmDelete", { name: b.nameAr }))) return;
    try { await deleteBranch(b.id); reload(); } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <h4 className="sub-head">{t("settings.branches.title")}</h4>
      <div className="form-grid">
        <label>{t("settings.branches.nameArLabel")}<input type="text" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
        <label>{t("settings.branches.nameEnLabel")}<input type="text" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
        <label>
          {t("settings.branches.countryLabel")}
          <select value={form.country} onChange={(e) => onCountryChange(e.target.value)}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{countryName(c.code, i18n.language)}</option>)}
          </select>
        </label>
        <label>
          {t("settings.branches.currencyLabel")}
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.symbolAr}</option>)}
          </select>
        </label>
        <label>
          {t("settings.branches.exchangeRateLabel")}
          <input type="number" step="0.000001" value={form.exchangeRateToCompanyCurrency} onChange={(e) => setForm({ ...form, exchangeRateToCompanyCurrency: e.target.value })} />
          <small style={{ color: "#8A7C5E", fontSize: 11 }}>{t("settings.branches.exchangeRateHint")}</small>
        </label>
      </div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
        {editingId && <button className="btn-ghost" onClick={cancelEdit}>{t("common.cancel")}</button>}
        <button className="btn-ghost" onClick={save}>{editingId ? t("settings.branches.saveChanges") : t("settings.branches.addBtn")}</button>
      </div>
      {error && <p className="balance-bad">{error}</p>}

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <table className="ledger-table">
          <thead><tr><th>{t("settings.branches.table.name")}</th><th>{t("settings.branches.table.country")}</th><th>{t("settings.branches.table.currency")}</th><th>{t("settings.branches.table.status")}</th><th></th></tr></thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td>{b.nameAr}{b.nameEn ? ` / ${b.nameEn}` : ""}</td>
                <td>{countryName(b.country, i18n.language)}</td>
                <td>{currencyLabel(b.currency, i18n.language)}{b.currency !== companyCurrency && b.exchangeRateToCompanyCurrency ? ` (×${b.exchangeRateToCompanyCurrency})` : ""}</td>
                <td><span className={"status-badge" + (b.isActive ? " status-posted" : " status-neutral")}>{b.isActive ? t("settings.branches.statusActive") : t("settings.branches.statusInactive")}</span></td>
                <td className="row-actions">
                  <button className="btn-ghost" onClick={() => startEdit(b)}>{t("common.edit")}</button>
                  <button className="btn-ghost" onClick={() => toggleActive(b)}>{b.isActive ? t("settings.branches.deactivate") : t("settings.branches.activate")}</button>
                  <button className="btn-ghost" onClick={() => remove(b)}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
            {branches.length === 0 && <tr><td className="empty" colSpan={5}>{t("settings.branches.empty")}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
