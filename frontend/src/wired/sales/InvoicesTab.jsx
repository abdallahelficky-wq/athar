import React, { useEffect, useState } from "react";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import {
  listSalesInvoices, createSalesInvoice, deleteSalesInvoice, postSalesInvoice, unpostSalesInvoice,
} from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import InvoiceLinesEditor, { emptyInvoiceLine } from "../shared/InvoiceLinesEditor";
import UnpostModal from "../shared/UnpostModal";

export default function InvoicesTab({ companyId }) {
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([emptyInvoiceLine()]);
  const [unpostTarget, setUnpostTarget] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then((cs) => { setCustomers(cs); if (cs[0]) setCustomerId((c) => c || cs[0].id); });
    listAccounts().then((accs) => setAccounts(accs.filter((a) => a.type === "revenue")));
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listSalesInvoices(companyId).then(setInvoices).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const customer = customers.find((c) => c.id === customerId);
  const invType = customer ? (customer.customerType === "business" && customer.vatNumber ? "standard" : "simplified") : "simplified";

  const save = async () => {
    if (!customerId) return;
    try {
      await createSalesInvoice({ companyId, customerId, date, lines: lines.filter((l) => l.accountId && Number(l.unitPrice) > 0) });
      setLines([emptyInvoiceLine()]);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (inv) => {
    if (!window.confirm(`حذف الفاتورة ${inv.invoiceNumber}؟`)) return;
    try {
      await deleteSalesInvoice(inv.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doPost = async (inv) => {
    try {
      await postSalesInvoice(inv.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostSalesInvoice(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>العميل
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>تاريخ الفاتورة<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">نوع الفاتورة (تلقائي)
            <input type="text" readOnly value={invType === "standard" ? "فاتورة ضريبية قياسية (B2B)" : "فاتورة ضريبية مبسّطة (B2C)"} />
          </label>
        </div>
        {customers.length === 0 && <p className="empty">أضف عميلاً أولاً من تبويب "العملاء".</p>}

        <InvoiceLinesEditor lines={lines} setLines={setLines} accounts={accounts} />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={!customerId}>حفظ وترحيل الفاتورة</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>النوع</th><th>الإجمالي</th><th>السداد</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.invoiceNumber}</td><td>{inv.customer?.name}</td><td>{inv.date.slice(0, 10)}</td>
                  <td>{inv.invoiceType === "standard" ? "قياسية" : "مبسّطة"}</td>
                  <td className="num">{fmt(inv.grandTotal)}</td>
                  <td><span className="status-badge">{inv.paymentStatus}</span></td>
                  <td><span className="status-badge">{inv.status === "posted" ? "مرحّلة" : "مسودة"}</span></td>
                  <td className="row-actions">
                    {inv.status === "draft" && (
                      <>
                        <button className="btn-ghost" onClick={() => remove(inv)}>حذف</button>
                        <button className="btn-primary" onClick={() => doPost(inv)}>ترحيل</button>
                      </>
                    )}
                    {inv.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostTarget(inv)}>فك الترحيل</button>}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td className="empty" colSpan={8}>لا توجد فواتير بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
    </div>
  );
}
