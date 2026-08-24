import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listCustomers, createCustomer, updateCustomer, deleteCustomer } from "../../api/customers";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import StatementOfAccountModal from "../StatementOfAccountModal";
import { currencyLabel } from "../../shared/countries";
import { routes } from "../../routes";

const emptyForm = () => ({
  name: "", customerType: "business", vatNumber: "", crNumber: "", nationalId: "",
  phone: "", email: "", buildingNo: "", street: "", district: "", city: "", postalCode: "", additionalNo: "",
  paymentTerms: "نقدي", creditLimit: "",
});

export default function CustomersTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [statementFor, setStatementFor] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listCustomers(companyId).then(setCustomers).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };

  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = { ...form, companyId, creditLimit: form.creditLimit || undefined };
      if (editingId) await updateCustomer(editingId, payload);
      else await createCustomer(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({ ...emptyForm(), ...c, creditLimit: c.creditLimit || "" });
  };

  const remove = async (c) => {
    if (!window.confirm(t("sales.customers.confirmDelete", { name: c.name }))) return;
    try {
      await deleteCustomer(c.id);
      reload();
      notify(t("sales.customers.deleted", { name: c.name }));
    } catch (err) {
      notify(err.message, "error");
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">{t("sales.customers.editingBanner", { name: form.name })}</div>}
        <div className="form-grid">
          <label>{t("sales.customers.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("sales.customers.type")}
            <select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
              <option value="business">{t("sales.customers.typeBusiness")}</option>
              <option value="individual">{t("sales.customers.typeIndividual")}</option>
            </select>
          </label>
          <label>{t("sales.customers.vatNumber")}<input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value.replace(/\D/g, "") })} /></label>
          <label>{t("sales.customers.crNumber")}<input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></label>
          <label>{t("sales.customers.phone")}<input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>{t("sales.customers.email")}<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>{t("sales.customers.city")}<input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>{t("sales.customers.paymentTerms")}
            <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
              <option value="نقدي">{t("sales.customers.paymentCash")}</option>
              <option value="آجل 30 يوم">{t("sales.customers.payment30")}</option>
              <option value="آجل 60 يوم">{t("sales.customers.payment60")}</option>
              <option value="آجل 90 يوم">{t("sales.customers.payment90")}</option>
            </select>
          </label>
          <label>{t("sales.customers.creditLimit", { currency })}<input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></label>
        </div>
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>{t("sales.customers.cancel")}</button>}
          <button className="btn-primary" onClick={save}>{editingId ? t("sales.customers.saveChanges") : t("sales.customers.saveCustomer")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("sales.customers.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.customers.table.name")}</th><th>{t("sales.customers.table.type")}</th>
                <th>{t("sales.customers.table.vatNumber")}</th><th>{t("sales.customers.table.paymentTerms")}</th>
                <th>{t("sales.customers.table.creditLimit")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.customerType === "business" ? t("sales.customers.typeBusinessShort") : t("sales.customers.typeIndividualShort")}</td>
                  <td>{c.vatNumber || "—"}</td>
                  <td>{c.paymentTerms || "—"}</td>
                  <td className="num">{c.creditLimit ? fmt(c.creditLimit) : "—"}</td>
                  <td className="row-actions">
                    <button className="icon-btn" title={t("sales.customers.viewStatement")} onClick={() => setStatementFor(c)}><Icon.BookOpen /></button>
                    {c.accountId && (
                      <Link className="icon-btn" title={t("sales.customers.viewInChart")} to={routes.accountLedger(c.accountId)}><Icon.Link /></Link>
                    )}
                    <button className="btn-ghost" onClick={() => startEdit(c)}>{t("sales.customers.edit")}</button>
                    <button className="btn-ghost" onClick={() => remove(c)}>{t("sales.customers.delete")}</button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && <tr><td className="empty" colSpan={6}>{t("sales.customers.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {statementFor && (
        <StatementOfAccountModal
          kind="customer"
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
