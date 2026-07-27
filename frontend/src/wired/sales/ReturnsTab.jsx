import React, { useEffect, useState } from "react";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import { listSalesInvoices } from "../../api/salesInvoices";
import { listSalesReturns, createSalesReturn, unpostSalesReturn } from "../../api/salesReturns";
import { fmt } from "../../legacy/constants";
import InvoiceLinesEditor, { emptyInvoiceLine } from "../shared/InvoiceLinesEditor";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";

export default function ReturnsTab({ companyId }) {
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [relatedInvoiceId, setRelatedInvoiceId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("account");
  const [lines, setLines] = useState([emptyInvoiceLine()]);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then((cs) => { setCustomers(cs); if (cs[0]) setCustomerId((c) => c || cs[0].id); });
    listAccounts().then((accs) => setAccounts(accs.filter((a) => a.type === "revenue")));
    listSalesInvoices(companyId).then(setInvoices);
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listSalesReturns(companyId).then(setReturns).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const customerInvoices = invoices.filter((i) => i.customerId === customerId);

  const save = async () => {
    if (!customerId) return;
    try {
      await createSalesReturn({
        companyId, customerId, relatedInvoiceId: relatedInvoiceId || undefined, date, reason, refundMethod,
        lines: lines.filter((l) => l.accountId && Number(l.unitPrice) > 0),
      });
      setLines([emptyInvoiceLine()]);
      setReason("");
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostSalesReturn(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>العميل
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setRelatedInvoiceId(""); }}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>الفاتورة الأصلية (اختياري)
            <select value={relatedInvoiceId} onChange={(e) => setRelatedInvoiceId(e.target.value)}>
              <option value="">— بدون ربط —</option>
              {customerInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber}</option>)}
            </select>
          </label>
          <label>تاريخ المردود<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>طريقة الرد
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="account">خصم من رصيد العميل (ذمم)</option>
              <option value="cash">رد نقدي</option>
              <option value="bank">رد بنكي</option>
            </select>
          </label>
          <label className="memo-field">سبب المردود<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>

        <InvoiceLinesEditor lines={lines} setLines={setLines} accounts={accounts} showVatToggle={false} />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={!customerId}>حفظ وترحيل المردود</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {returns.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>{r.returnNumber}</td><td>{r.customer?.name}</td><td>{r.date.slice(0, 10)}</td>
                    <td className="num">{fmt(r.grandTotal)}</td>
                    <td><span className="status-badge">{r.status === "posted" ? "مرحّل" : "مسودة"}</span></td>
                    <td className="row-actions">
                      {r.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostTarget(r)}>فك الترحيل</button>}
                      <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === r.id ? null : r.id)}>
                        {attachmentsFor === r.id ? "إخفاء المرفقات" : "المرفقات"}
                      </button>
                    </td>
                  </tr>
                  {attachmentsFor === r.id && (
                    <tr><td colSpan={6}><AttachmentsPanel entityType="sales_return" entityId={r.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {returns.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد مردودات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
    </div>
  );
}
