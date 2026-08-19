import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from "../../api/warehouses";

const emptyForm = () => ({ name: "", code: "", location: "", isDefault: false });

export default function WarehousesTab({ companyId }) {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    listWarehouses(companyId).then(setWarehouses).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = { ...form, companyId, code: form.code || undefined, location: form.location || undefined };
      if (editingId) await updateWarehouse(editingId, payload);
      else await createWarehouse(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) { setError(err.message); }
  };

  const startEdit = (w) => {
    setEditingId(w.id);
    setForm({ name: w.name, code: w.code || "", location: w.location || "", isDefault: w.isDefault });
  };

  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const remove = async (w) => {
    if (!window.confirm(t("inventory.warehouses.confirmDelete", { name: w.name }))) return;
    try { await deleteWarehouse(w.id); reload(); } catch (err) { setError(err.message); }
  };

  const toggleArchive = async (w) => {
    try { await updateWarehouse(w.id, { isArchived: !w.isArchived }); reload(); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("inventory.warehouses.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("inventory.warehouses.code")}<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>{t("inventory.warehouses.location")}<input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> {t("inventory.warehouses.isDefault")}</label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={cancelEdit}>{t("inventory.warehouses.cancel")}</button>}
          <button className="btn-primary" onClick={save} disabled={!form.name.trim()}>{editingId ? t("inventory.warehouses.saveChanges") : t("inventory.warehouses.addWarehouse")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("inventory.warehouses.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("inventory.warehouses.table.name")}</th><th>{t("inventory.warehouses.table.code")}</th>
                <th>{t("inventory.warehouses.table.location")}</th><th>{t("inventory.warehouses.table.isDefault")}</th>
                <th>{t("inventory.warehouses.table.status")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td><td>{w.code || "—"}</td><td>{w.location || "—"}</td>
                  <td>{w.isDefault ? "✓" : "—"}</td>
                  <td><span className={`archive-status ${w.isArchived ? "archived" : ""}`}><i />{w.isArchived ? t("inventory.warehouses.archived") : t("inventory.warehouses.active")}</span></td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(w)}>{t("inventory.warehouses.edit")}</button>
                    <button className="btn-ghost" onClick={() => toggleArchive(w)}>{w.isArchived ? t("inventory.warehouses.unarchive") : t("inventory.warehouses.archive")}</button>
                    <button className="btn-ghost" onClick={() => remove(w)}>{t("inventory.warehouses.delete")}</button>
                  </td>
                </tr>
              ))}
              {warehouses.length === 0 && <tr><td className="empty" colSpan={6}>{t("inventory.warehouses.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
