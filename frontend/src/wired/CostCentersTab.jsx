import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCostCenters, createCostCenter, updateCostCenter, deleteCostCenter } from "../api/costCenters";
import Breadcrumb from "./shared/Breadcrumb";
import { getOrgDisplayName } from "./shared/accountDisplayName";

const emptyForm = () => ({ name: "", nameEn: "" });

/**
 * إدارة مراكز التكلفة — كانت لا تُنشأ إلا من شاشة المحطات. المركز يُنشأ خاصاً بالشركة الحالية، بعربي وإنجليزي
 * (الإنجليزي يظهر حين تكون الواجهة إنجليزية). الحذف يرفضه الخادم/القاعدة إن كان المركز مستخدَماً.
 */
export default function CostCentersTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const reload = () => {
    setLoading(true);
    setError("");
    listCostCenters().then(setCostCenters).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const companyCostCenters = costCenters.filter((c) => !c.companyId || c.companyId === companyId);

  const save = async () => {
    if (form.name.trim().length < 2) return;
    try {
      const payload = { name: form.name.trim(), nameEn: form.nameEn.trim() || null, companyId };
      if (editingId) await updateCostCenter(editingId, payload);
      else await createCostCenter(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) { setError(err.message); }
  };

  const startEdit = (c) => { setEditingId(c.id); setForm({ name: c.name, nameEn: c.nameEn || "" }); };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const remove = async (c) => {
    if (!window.confirm(t("costCenters.confirmDelete", { name: getOrgDisplayName(c, i18n.language) }))) return;
    try { await deleteCostCenter(c.id); reload(); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("nav.groups.accounts"), t("nav.tabs.costCenters")]} />
        <h2>{t("nav.tabs.costCenters")}</h2>
      </div>

      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("costCenters.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("costCenters.nameEn")}<input type="text" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
        </div>
        <p className="note">{t("costCenters.note")}</p>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={cancelEdit}>{t("common.cancel")}</button>}
          <button className="btn-primary" onClick={save} disabled={form.name.trim().length < 2}>{editingId ? t("costCenters.saveChanges") : t("costCenters.addCostCenter")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("costCenters.name")}</th><th>{t("costCenters.nameEn")}</th><th></th></tr></thead>
            <tbody>
              {companyCostCenters.map((c) => (
                <tr key={c.id}>
                  <td>{getOrgDisplayName(c, i18n.language)}</td>
                  <td dir="ltr">{c.nameEn || "—"}</td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(c)}>{t("common.edit")}</button>
                    <button className="btn-ghost" onClick={() => remove(c)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
              {companyCostCenters.length === 0 && <tr><td className="empty" colSpan={3}>{t("costCenters.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
