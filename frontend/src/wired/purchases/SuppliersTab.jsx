import PurchaseFilters from "./PurchaseFilters";
import PurchaseFormDialog from "./PurchaseFormDialog";
import {filterSuppliers} from "./purchaseFilterUtils";
import {useUnsavedChangesGuard} from "../shared/UnsavedChangesContext";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from "../../api/suppliers";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import StatementOfAccountModal from "../StatementOfAccountModal";
import { routes } from "../../routes";

const emptyForm = () => ({ name: "", vatNumber: "", crNumber: "", phone: "", email: "", city: "", paymentTerms: "آجل 30 يوم" });

export default function SuppliersTab({ companyId, companies }) {
  const { t } = useTranslation();
  const [formOpen,setFormOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [formError,setFormError]=useState("");
  const [dirty,setDirty]=useState(false);
  const [filters,setFilters]=useState({search:"",city:"",terms:""});
  useUnsavedChangesGuard(dirty);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [statementFor, setStatementFor] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listSuppliers(companyId).then(setSuppliers).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  useEffect(()=>{setFilters({search:"",city:"",terms:""});setFormOpen(false);setDirty(false);setForm(emptyForm());setEditingId(null);},[companyId]);
  const closeForm=()=>{if(saving || (dirty&&!window.confirm(t("purchaseFilters.discard"))))return;setFormOpen(false);setDirty(false);setFormError("");};
  const visibleSuppliers=filterSuppliers(suppliers,filters);
  const save = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);setFormError("");
    try {
      const payload = { ...form, companyId };
      if (editingId) await updateSupplier(editingId, payload);
      else await createSupplier(payload);
      setForm(emptyForm());
      setEditingId(null);
      setFormOpen(false);setDirty(false);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {setSaving(false);}
  };

  const startEdit = (s) => { setFormOpen(true);setDirty(false);setFormError(""); setEditingId(s.id); setForm({ ...emptyForm(), ...s }); };
  const remove = async (s) => {
    if (!window.confirm(t("purchases.suppliers.confirmDelete", { name: s.name }))) return;
    try {
      await deleteSupplier(s.id);
      reload();
      notify(t("purchases.suppliers.deleted", { name: s.name }));
    } catch (err) {
      notify(err.message, "error");
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="form-btn-group"><button className="btn-primary" onClick={()=>{setForm(emptyForm());setEditingId(null);setDirty(false);setFormError("");setFormOpen(true);}}>{t("purchaseFilters.addSupplier")}</button></div>
      <PurchaseFilters value={filters} onChange={setFilters} count={visibleSuppliers.length} total={suppliers.length} fields={[{key:"search"},{key:"city",options:[...new Set(suppliers.map(s=>s.city).filter(Boolean))].sort().map(v=>({value:v,label:v}))},{key:"terms",options:[...new Set(suppliers.map(s=>s.paymentTerms).filter(Boolean))].sort().map(v=>({value:v,label:v}))}]} />
      {formOpen && <PurchaseFormDialog title={t(editingId?"purchaseFilters.editSupplier":"purchaseFilters.addSupplier")} onClose={closeForm} saving={saving}>
      <div onChange={()=>setDirty(true)}>
        {editingId && <div className="edit-banner">{t("purchases.suppliers.editingBanner", { name: form.name })}</div>}
        <div className="form-grid">
          <label>{t("purchases.suppliers.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("purchases.suppliers.vatNumber")}<input type="text" value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} /></label>
          <label>{t("purchases.suppliers.crNumber")}<input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></label>
          <label>{t("purchases.suppliers.phone")}<input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>{t("purchases.suppliers.email")}<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>{t("purchases.suppliers.city")}<input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>{t("purchases.suppliers.paymentTerms")}
            <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
              <option value="نقدي">{t("purchases.suppliers.paymentCash")}</option>
              <option value="آجل 30 يوم">{t("purchases.suppliers.payment30")}</option>
              <option value="آجل 60 يوم">{t("purchases.suppliers.payment60")}</option>
              <option value="آجل 90 يوم">{t("purchases.suppliers.payment90")}</option>
            </select>
          </label>
        </div>
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={closeForm} disabled={saving}>{t("purchases.suppliers.cancel")}</button>
          <button className="btn-primary" disabled={saving || !form.name.trim()} onClick={save}>{editingId ? t("purchases.suppliers.saveChanges") : t("purchases.suppliers.saveSupplier")}</button>
        </div>
      {formError && <p className="balance-bad" role="alert">{formError}</p>}
      </div></PurchaseFormDialog>}

      {loading ? <p className="empty">{t("purchases.suppliers.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("purchases.suppliers.table.name")}</th><th>{t("purchases.suppliers.table.vatNumber")}</th>
                <th>{t("purchases.suppliers.table.city")}</th><th>{t("purchases.suppliers.table.paymentTerms")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visibleSuppliers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td><td>{s.vatNumber || "—"}</td><td>{s.city || "—"}</td><td>{s.paymentTerms || "—"}</td>
                  <td className="row-actions">
                    <button className="icon-btn" title={t("purchases.suppliers.viewStatement")} onClick={() => setStatementFor(s)}><Icon.BookOpen /></button>
                    {s.accountId && (
                      <Link className="icon-btn" title={t("purchases.suppliers.viewInChart")} to={routes.accountLedger(s.accountId)}><Icon.Link /></Link>
                    )}
                    <button className="btn-ghost" onClick={() => startEdit(s)}>{t("purchases.suppliers.edit")}</button>
                    <button className="btn-ghost" onClick={() => remove(s)}>{t("purchases.suppliers.delete")}</button>
                  </td>
                </tr>
              ))}
              {visibleSuppliers.length === 0 && <tr><td className="empty" colSpan={5}>{t(suppliers.length ? "purchaseFilters.noResults" : "purchases.suppliers.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {statementFor && (
        <StatementOfAccountModal
          kind="supplier"
          party={statementFor}
          companyId={companyId}
          companies={companies}
          onClose={() => setStatementFor(null)}
        />
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
