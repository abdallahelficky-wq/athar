import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listCompanyBankAccounts, createCompanyBankAccount, updateCompanyBankAccount, deleteCompanyBankAccount,
} from "../api/companyBankAccounts";

const emptyForm = () => ({ bankName: "", accountNumber: "", iban: "" });

/**
 * الحسابات البنكية الرسمية للشركة — تُعرَض في بعض قوالب الفواتير (مثل "كلاسيكي احترافي") عند
 * وجودها فقط، بلا أي تأثير على القوالب الأخرى. عدة حسابات لكل شركة (راجحي/رياض/...)، بترتيب
 * عرض يدوي (sortOrder) قابل للتعديل بأزرار ↑/↓ بنفس نمط BranchesPanel.jsx.
 */
export default function CompanyBankAccountsPanel({ companyId }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const reload = () => {
    setLoading(true);
    listCompanyBankAccounts(companyId).then(setAccounts).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.bankName.trim() || !form.accountNumber.trim() || !form.iban.trim()) {
      setError(t("settings.bankAccounts.errRequired"));
      return;
    }
    setError("");
    try {
      const payload = { companyId, bankName: form.bankName.trim(), accountNumber: form.accountNumber.trim(), iban: form.iban.trim() };
      if (editingId) await updateCompanyBankAccount(editingId, payload);
      else await createCompanyBankAccount({ ...payload, sortOrder: accounts.length });
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    setForm({ bankName: a.bankName, accountNumber: a.accountNumber, iban: a.iban });
  };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const remove = async (a) => {
    if (!window.confirm(t("settings.bankAccounts.confirmDelete", { name: a.bankName }))) return;
    try { await deleteCompanyBankAccount(a.id); reload(); } catch (err) { setError(err.message); }
  };

  const move = async (a, direction) => {
    const ordered = [...accounts].sort((x, y) => x.sortOrder - y.sortOrder);
    const idx = ordered.findIndex((x) => x.id === a.id);
    const swapWith = ordered[idx + direction];
    if (!swapWith) return;
    try {
      await Promise.all([
        updateCompanyBankAccount(a.id, { sortOrder: swapWith.sortOrder }),
        updateCompanyBankAccount(swapWith.id, { sortOrder: a.sortOrder }),
      ]);
      reload();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <h4 className="sub-head">{t("settings.bankAccounts.title")}</h4>
      <p className="note">{t("settings.bankAccounts.note")}</p>
      <div className="form-grid">
        <label>{t("settings.bankAccounts.bankNameLabel")}<input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></label>
        <label>{t("settings.bankAccounts.accountNumberLabel")}<input type="text" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} /></label>
        <label>{t("settings.bankAccounts.ibanLabel")}<input type="text" dir="ltr" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} /></label>
      </div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
        {editingId && <button className="btn-ghost" onClick={cancelEdit}>{t("common.cancel")}</button>}
        <button className="btn-ghost" onClick={save}>{editingId ? t("settings.bankAccounts.saveChanges") : t("settings.bankAccounts.addBtn")}</button>
      </div>
      {error && <p className="balance-bad">{error}</p>}

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <table className="ledger-table">
          <thead><tr><th>{t("settings.bankAccounts.table.bankName")}</th><th>{t("settings.bankAccounts.table.accountNumber")}</th><th>{t("settings.bankAccounts.table.iban")}</th><th></th></tr></thead>
          <tbody>
            {[...accounts].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => (
              <tr key={a.id}>
                <td>{a.bankName}</td>
                <td className="num">{a.accountNumber}</td>
                <td className="num">{a.iban}</td>
                <td className="row-actions">
                  <button className="btn-ghost" onClick={() => move(a, -1)} title={t("settings.bankAccounts.moveUp")}>↑</button>
                  <button className="btn-ghost" onClick={() => move(a, 1)} title={t("settings.bankAccounts.moveDown")}>↓</button>
                  <button className="btn-ghost" onClick={() => startEdit(a)}>{t("common.edit")}</button>
                  <button className="btn-ghost" onClick={() => remove(a)}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td className="empty" colSpan={4}>{t("settings.bankAccounts.empty")}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
