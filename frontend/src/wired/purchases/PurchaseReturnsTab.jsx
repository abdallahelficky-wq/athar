import React, { useEffect, useState } from "react";
import { listSuppliers } from "../../api/suppliers";
import { listAccounts } from "../../api/accounts";
import { listPurchaseInvoices } from "../../api/purchaseInvoices";
import { listPurchaseReturns, createPurchaseReturn, unpostPurchaseReturn } from "../../api/purchaseReturns";
import { fmt } from "../../legacy/constants";
import InvoiceLinesEditor, { emptyInvoiceLine } from "../shared/InvoiceLinesEditor";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";

export default function PurchaseReturnsTab({ companyId }) {
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [relatedInvoiceId, setRelatedInvoiceId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ ...emptyInvoiceLine(), priceIncludesVat: false }]);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    listSuppliers(companyId).then((ss) => { setSuppliers(ss); if (ss[0]) setSupplierId((s) => s || ss[0].id); });
    listAccounts({ companyId }).then(setAccounts);
    listPurchaseInvoices(companyId).then(setInvoices);
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listPurchaseReturns(companyId).then(setReturns).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const supplierInvoices = invoices.filter((i) => i.supplierId === supplierId);

  const save = async () => {
    if (!supplierId) return;
    try {
      await createPurchaseReturn({
        companyId, supplierId, relatedInvoiceId: relatedInvoiceId || undefined, date, reason,
        lines: lines.filter((l) => l.accountId && Number(l.unitPrice) > 0),
      });
      setLines([{ ...emptyInvoiceLine(), priceIncludesVat: false }]);
      setReason("");
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostPurchaseReturn(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>المورد<select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setRelatedInvoiceId(""); }}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>الفاتورة الأصلية (اختياري)
            <select value={relatedInvoiceId} onChange={(e) => setRelatedInvoiceId(e.target.value)}>
              <option value="">— بدون ربط —</option>
              {supplierInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber}</option>)}
            </select>
          </label>
          <label>تاريخ المردود<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">سبب المردود<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>

        <InvoiceLinesEditor lines={lines} setLines={setLines} accounts={accounts} showVatToggle={false} />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={!supplierId}>حفظ وترحيل المردود</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الرقم</th><th>المورد</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {returns.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>{r.returnNumber}</td><td>{r.supplier?.name}</td><td>{r.date.slice(0, 10)}</td>
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
                    <tr><td colSpan={6}><AttachmentsPanel entityType="purchase_return" entityId={r.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {returns.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد مردودات مشتريات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
    </div>
  );
}
