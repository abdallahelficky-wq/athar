import React, { useEffect, useState } from "react";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import { listQuotations, createQuotation, deleteQuotation, convertQuotationToInvoice } from "../../api/quotations";
import { fmt } from "../../legacy/constants";
import InvoiceLinesEditor, { emptyInvoiceLine } from "../shared/InvoiceLinesEditor";

export default function QuotationsTab({ companyId }) {
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState([emptyInvoiceLine()]);

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then((cs) => { setCustomers(cs); if (cs[0]) setCustomerId((c) => c || cs[0].id); });
    listAccounts({ companyId }).then((accs) => setAccounts(accs.filter((a) => a.type === "revenue")));
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listQuotations(companyId).then(setQuotations).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const resetForm = () => { setLines([emptyInvoiceLine()]); setValidUntil(""); };

  const save = async () => {
    if (!customerId) return;
    try {
      await createQuotation({
        companyId, customerId, date, validUntil: validUntil || undefined,
        lines: lines.filter((l) => l.accountId && Number(l.unitPrice) > 0),
      });
      resetForm();
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const convert = async (q) => {
    try {
      await convertQuotationToInvoice(q.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (q) => {
    if (!window.confirm(`حذف عرض السعر ${q.quoteNumber}؟`)) return;
    try {
      await deleteQuotation(q.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
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
          <label>تاريخ العرض<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>صالح حتى<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
        </div>
        {customers.length === 0 && <p className="empty">أضف عميلاً أولاً من تبويب "العملاء".</p>}

        <InvoiceLinesEditor lines={lines} setLines={setLines} accounts={accounts} />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={!customerId}>حفظ عرض السعر</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id}>
                  <td>{q.quoteNumber}</td><td>{q.customer?.name}</td><td>{q.date.slice(0, 10)}</td>
                  <td className="num">{fmt(q.grandTotal)}</td>
                  <td><span className="status-badge">{q.status === "converted" ? "تم التحويل" : "مسودة"}</span></td>
                  <td className="row-actions">
                    {q.status === "draft" && (
                      <>
                        <button className="btn-primary" onClick={() => convert(q)}>تحويل لفاتورة</button>
                        <button className="btn-ghost" onClick={() => remove(q)}>حذف</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {quotations.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد عروض أسعار بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
