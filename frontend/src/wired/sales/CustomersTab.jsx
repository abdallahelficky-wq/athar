import React, { useEffect, useState } from "react";
import { listCustomers, createCustomer, updateCustomer, deleteCustomer } from "../../api/customers";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import StatementOfAccountModal from "../StatementOfAccountModal";

const emptyForm = () => ({
  name: "", customerType: "business", vatNumber: "", crNumber: "", nationalId: "",
  phone: "", email: "", buildingNo: "", street: "", district: "", city: "", postalCode: "", additionalNo: "",
  paymentTerms: "نقدي", creditLimit: "",
});

export default function CustomersTab({ companyId, companies }) {
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
    if (!window.confirm(`حذف العميل "${c.name}"؟`)) return;
    try {
      await deleteCustomer(c.id);
      reload();
      notify(`تم حذف العميل "${c.name}".`);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل بيانات العميل — {form.name}</div>}
        <div className="form-grid">
          <label>اسم العميل<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>نوع العميل
            <select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
              <option value="business">منشأة (فاتورة ضريبية قياسية)</option>
              <option value="individual">فرد (فاتورة ضريبية مبسّطة)</option>
            </select>
          </label>
          <label>الرقم الضريبي (15 رقم)<input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value.replace(/\D/g, "") })} /></label>
          <label>السجل التجاري<input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></label>
          <label>الجوال<input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>المدينة<input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>شروط الدفع
            <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
              <option>نقدي</option><option>آجل 30 يوم</option><option>آجل 60 يوم</option><option>آجل 90 يوم</option>
            </select>
          </label>
          <label>حد الائتمان (ر.س)<input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></label>
        </div>
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>إلغاء</button>}
          <button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ بيانات العميل"}</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الاسم</th><th>النوع</th><th>الرقم الضريبي</th><th>شروط الدفع</th><th>حد الائتمان</th><th></th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.customerType === "business" ? "منشأة" : "فرد"}</td>
                  <td>{c.vatNumber || "—"}</td>
                  <td>{c.paymentTerms || "—"}</td>
                  <td className="num">{c.creditLimit ? fmt(c.creditLimit) : "—"}</td>
                  <td className="row-actions">
                    <button className="icon-btn" title="كشف حساب العميل" onClick={() => setStatementFor(c)}><Icon.BookOpen /></button>
                    <button className="btn-ghost" onClick={() => startEdit(c)}>تعديل</button>
                    <button className="btn-ghost" onClick={() => remove(c)}>حذف</button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && <tr><td className="empty" colSpan={6}>لا يوجد عملاء بعد.</td></tr>}
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
