import React, { useEffect, useState } from "react";
import { listReceipts, addReceiptAllocation, removeReceiptAllocation, createReceipt } from "../../api/receipts";
import { getSalesInvoice } from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";

/**
 * ربط/فك ربط فاتورة مبيعات بسند قبض — تدعم اختيار سند قائم أو إنشاء سند جديد وربطه،
 * وكذلك فك ربط أي تخصيص حالي (السند قد يكون مرتبطاً بعدة فواتير، والفاتورة قد ترتبط
 * بأكثر من سند إن كانت مسددة على دفعات من سندات مختلفة).
 */
export default function LinkPaymentModal({ invoice: initialInvoice, companyId, onClose, onChanged }) {
  const [invoice, setInvoice] = useState(initialInvoice);
  const [receipts, setReceipts] = useState([]);
  const [mode, setMode] = useState("existing");
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [amount, setAmount] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newMethod, setNewMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const paid = invoice.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
  const due = Math.max(0, Number(invoice.grandTotal) - paid);

  const loadReceipts = () => listReceipts(companyId, invoice.customerId).then(setReceipts);
  useEffect(() => { loadReceipts(); }, [invoice.customerId]);
  useEffect(() => { setAmount(due > 0.5 ? due.toFixed(2) : ""); }, [invoice.id, paid]);

  const linkedReceiptIds = new Set(invoice.receiptAllocations.map((a) => a.receiptId));
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const candidateReceipts = receipts.filter((r) => !linkedReceiptIds.has(r.id));

  const refresh = async () => {
    const fresh = await getSalesInvoice(invoice.id);
    setInvoice(fresh);
    await loadReceipts();
    return fresh;
  };

  const linkExisting = async () => {
    if (!selectedReceiptId || !(Number(amount) > 0)) return;
    setBusy(true); setError("");
    try {
      await addReceiptAllocation(selectedReceiptId, invoice.id, Number(amount));
      await refresh();
      setSelectedReceiptId("");
      onChanged(`تم ربط الفاتورة ${invoice.invoiceNumber} بسند القبض بنجاح.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const linkNew = async () => {
    if (!(Number(amount) > 0)) return;
    setBusy(true); setError("");
    try {
      await createReceipt({
        companyId, customerId: invoice.customerId, date: newDate, method: newMethod,
        allocations: [{ invoiceId: invoice.id, amount: Number(amount) }],
      });
      await refresh();
      onChanged(`تم إنشاء سند قبض جديد وربطه بالفاتورة ${invoice.invoiceNumber} بنجاح.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (receiptId, receiptNumber) => {
    if (!window.confirm(`فك ربط الفاتورة عن سند القبض ${receiptNumber}؟`)) return;
    setBusy(true); setError("");
    try {
      await removeReceiptAllocation(receiptId, invoice.id);
      const fresh = await refresh();
      const freshPaid = fresh.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
      const status = freshPaid <= 0 ? "غير مسددة" : (freshPaid < Number(fresh.grandTotal) - 0.5 ? "مسددة جزئياً" : "مسددة");
      onChanged(`تم فك ربط الفاتورة ${invoice.invoiceNumber} عن سند القبض ${receiptNumber}. حالة السداد الآن: ${status}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="invoice-modal-box" style={{ maxWidth: 680 }}>
        <div className="modal-title-row">
          <h3>ربط الفاتورة {invoice.invoiceNumber} بسند قبض</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="إغلاق">×</button>
        </div>
        <p className="note">
          الإجمالي {fmt(Number(invoice.grandTotal))} ر.س — المسدد {fmt(paid)} ر.س — المتبقي <strong>{fmt(due)} ر.س</strong>
        </p>

        {invoice.receiptAllocations.length > 0 && (
          <>
            <h4 className="sub-head">السندات المرتبطة حالياً</h4>
            <table className="lines-table">
              <thead><tr><th>رقم السند</th><th>التاريخ</th><th>الحالة</th><th>المبلغ المخصص</th><th></th></tr></thead>
              <tbody>
                {invoice.receiptAllocations.map((a) => {
                  const r = receiptById.get(a.receiptId);
                  return (
                    <tr key={a.id}>
                      <td>{r?.receiptNumber || "..."}</td>
                      <td>{r?.date ? r.date.slice(0, 10) : "—"}</td>
                      <td><span className="status-badge">{r?.status === "posted" ? "مرحّل" : "مسودة"}</span></td>
                      <td className="num">{fmt(Number(a.amount))}</td>
                      <td>
                        <button
                          className="icon-btn icon-btn-warn" title="فك الربط" disabled={busy || !r}
                          onClick={() => unlink(a.receiptId, r?.receiptNumber || "")}
                        ><Icon.Unlink /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {error && <p className="balance-bad">{error}</p>}

        {due > 0.5 && (
          <>
            <h4 className="sub-head">ربط بسند قبض جديد أو موجود</h4>
            <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 10 }}>
              <button className={mode === "existing" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("existing")}>سند موجود</button>
              <button className={mode === "new" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("new")}>سند جديد</button>
            </div>

            {mode === "existing" ? (
              <div className="form-grid">
                <label>السند
                  <select value={selectedReceiptId} onChange={(e) => setSelectedReceiptId(e.target.value)}>
                    <option value="">— اختر —</option>
                    {candidateReceipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.receiptNumber} ({fmt(Number(r.totalAmount))} ر.س — {r.status === "posted" ? "مرحّل" : "مسودة"})
                      </option>
                    ))}
                  </select>
                </label>
                <label>المبلغ المخصص<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              </div>
            ) : (
              <div className="form-grid">
                <label>تاريخ السند<input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></label>
                <label>طريقة التحصيل
                  <select value={newMethod} onChange={(e) => setNewMethod(e.target.value)}>
                    <option value="cash">كاش</option><option value="bank">بنك</option>
                  </select>
                </label>
                <label>المبلغ<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              </div>
            )}
            <div className="form-btn-group">
              <button className="btn-primary" disabled={busy} onClick={mode === "existing" ? linkExisting : linkNew}>
                {busy ? "جارٍ الحفظ..." : (mode === "existing" ? "ربط بالسند المحدد" : "إنشاء السند وربطه")}
              </button>
            </div>
          </>
        )}

        <div className="form-btn-group" style={{ marginTop: 16 }}>
          <button className="btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}
