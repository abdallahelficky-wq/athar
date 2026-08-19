import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listDepartments, createDepartment, updateDepartment, deleteDepartment } from "../api/departments";
import Breadcrumb from "./shared/Breadcrumb";

const emptyForm = () => ({ name: "" });

/**
 * إدارة الأقسام — تصنيف إداري لسطور القيود (بجانب مركز التكلفة)، يُستخدَم في نافذة القيد اليدوي
 * وكفلتر في كشف حساب الأستاذ. القسم يُنشأ دائماً خاصاً بالشركة الحالية (companyId)، رغم أن الحقل
 * في القاعدة اختياري (يدعم أقسام مشتركة بين كل شركات المستأجر) — بنفس مبدأ CostCenter تماماً.
 */
export default function DepartmentsTab({ companyId }) {
  const { t } = useTranslation();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const reload = () => {
    setLoading(true);
    setError("");
    listDepartments().then(setDepartments).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const companyDepartments = departments.filter((d) => !d.companyId || d.companyId === companyId);

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = { name: form.name.trim(), companyId };
      if (editingId) await updateDepartment(editingId, payload);
      else await createDepartment(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) { setError(err.message); }
  };

  const startEdit = (d) => { setEditingId(d.id); setForm({ name: d.name }); };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const remove = async (d) => {
    if (!window.confirm(t("departments.confirmDelete", { name: d.name }))) return;
    try { await deleteDepartment(d.id); reload(); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("nav.groups.accounts"), t("nav.tabs.departments")]} />
        <h2>{t("nav.tabs.departments")}</h2>
      </div>

      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("departments.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={cancelEdit}>{t("common.cancel")}</button>}
          <button className="btn-primary" onClick={save} disabled={!form.name.trim()}>{editingId ? t("departments.saveChanges") : t("departments.addDepartment")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("departments.name")}</th><th></th></tr></thead>
            <tbody>
              {companyDepartments.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(d)}>{t("common.edit")}</button>
                    <button className="btn-ghost" onClick={() => remove(d)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
              {companyDepartments.length === 0 && <tr><td className="empty" colSpan={2}>{t("departments.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
