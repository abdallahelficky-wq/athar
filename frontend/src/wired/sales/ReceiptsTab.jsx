import React, { useEffect, useState } from "react";
import { listCustomers } from "../../api/customers";
import { listReceipts, getOutstandingInvoices, createReceipt, unpostReceipt } from "../../api/receipts";
import { fmt } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";

export default function ReceiptsTab({ companyId }) {
  const [customers, setCustomers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [allocations, setAllocations] = useState({});
  const [unpostTarget, setUnpostTarget] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then((cs) => { setCustomers(cs); if (cs[0]) setCustomerId((c) => c || cs[0].id); });
  }, [companyId]);

  useEffect(() => {
    if (!customerId) { setOutstanding([]); return; }
    getOutstandingInvoices(customerId).then(setOutstanding);
    setAllocations({});
  }, [customerId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listReceipts(companyId).then(setReceipts).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + Number(v || 0), 0);
  const setAlloc = (invId, value) => setAllocations((prev) => ({ ...prev, [invId]: value }));

  const save = async () => {
    if (!customerId || totalAllocated <= 0) return;
    try {
      await createReceipt({
        companyId, customerId, date, method,
        allocations: Object.entries(allocations).filter(([, v]) => Number(v) > 0).map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) })),
      });
      setAllocations({});
      getOutstandingInvoices(customerId).then(setOutstanding);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostReceipt(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>العميل<select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>تاريخ السند<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>طريقة التحصيل<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">كاش</option><option value="bank">بنك</option></select></label>
        </div>

        <h3 className="sub-head">الفواتير المستحقة على هذا العميل</h3>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الفاتورة</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>المبلغ المخصص</th></tr></thead>
            <tbody>
              {outstanding.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.invoiceNumber}</td>
                  <td className="num">{fmt(inv.grandTotal)}</td>
                  <td className="num">{fmt(inv.paid)}</td>
                  <td className="num strong">{fmt(inv.due)}</td>
                  <td><input type="number" className="amount-input" value={allocations[inv.id] || ""} onChange={(e) => setAlloc(inv.id, e.target.value)} placeholder="0.00" /></td>
                </tr>
              ))}
              {outstanding.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد فواتير مستحقة على هذا العميل.</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={totalAllocated <= 0}>حفظ وترحيل السند ({fmt(totalAllocated)} ر.س)</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>الطريقة</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.receiptNumber}</td><td>{r.customer?.name}</td><td>{r.date.slice(0, 10)}</td>
                  <td>{r.method === "cash" ? "كاش" : "بنك"}</td>
                  <td className="num">{fmt(r.totalAmount)}</td>
                  <td><span className="status-badge">{r.status === "posted" ? "مرحّل" : "مسودة"}</span></td>
                  <td className="row-actions">
                    {r.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostTarget(r)}>فك الترحيل</button>}
                  </td>
                </tr>
              ))}
              {receipts.length === 0 && <tr><td className="empty" colSpan={7}>لا توجد سندات قبض بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
    </div>
  );
}
