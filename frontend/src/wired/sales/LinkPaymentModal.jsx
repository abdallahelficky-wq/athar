import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listReceipts, addReceiptAllocation, removeReceiptAllocation, createReceipt } from "../../api/receipts";
import { getSalesInvoice } from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { currencyLabel } from "../../shared/countries";

/**
 * ربط/فك ربط فاتورة مبيعات بسند قبض — تدعم اختيار سند قائم أو إنشاء سند جديد وربطه،
 * وكذلك فك ربط أي تخصيص حالي (السند قد يكون مرتبطاً بعدة فواتير، والفاتورة قد ترتبط
 * بأكثر من سند إن كانت مسددة على دفعات من سندات مختلفة).
 */
export default function LinkPaymentModal({ invoice: initialInvoice, companyId, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const [invoice, setInvoice] = useState(initialInvoice);
  const currency = currencyLabel(invoice?.company?.currency, i18n.language);
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
      onChanged(t("sales.linkPaymentModal.linkedMsg", { number: invoice.invoiceNumber }));
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
      onChanged(t("sales.linkPaymentModal.createdAndLinkedMsg", { number: invoice.invoiceNumber }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (receiptId, receiptNumber) => {
    if (!window.confirm(t("sales.linkPaymentModal.confirmUnlink", { receiptNumber }))) return;
    setBusy(true); setError("");
    try {
      await removeReceiptAllocation(receiptId, invoice.id);
      const fresh = await refresh();
      const freshPaid = fresh.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
      const status = freshPaid <= 0 ? t("sales.linkPaymentModal.statusUnpaid") : (freshPaid < Number(fresh.grandTotal) - 0.5 ? t("sales.linkPaymentModal.statusPartial") : t("sales.linkPaymentModal.statusPaid"));
      onChanged(t("sales.linkPaymentModal.unlinkedMsg", { number: invoice.invoiceNumber, receiptNumber, status }));
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
          <h3>{t("sales.linkPaymentModal.title", { number: invoice.invoiceNumber })}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label={t("sales.linkPaymentModal.close")}>×</button>
        </div>
        <p className="note">
          {t("sales.linkPaymentModal.summary", { total: fmt(Number(invoice.grandTotal)), paid: fmt(paid), due: fmt(due), currency })}
        </p>

        {invoice.receiptAllocations.length > 0 && (
          <>
            <h4 className="sub-head">{t("sales.linkPaymentModal.linkedTitle")}</h4>
            <table className="lines-table">
              <thead>
                <tr>
                  <th>{t("sales.linkPaymentModal.table.receiptNumber")}</th><th>{t("sales.linkPaymentModal.table.date")}</th>
                  <th>{t("sales.linkPaymentModal.table.status")}</th><th>{t("sales.linkPaymentModal.table.allocated")}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoice.receiptAllocations.map((a) => {
                  const r = receiptById.get(a.receiptId);
                  return (
                    <tr key={a.id}>
                      <td>{r?.receiptNumber || "..."}</td>
                      <td>{r?.date ? r.date.slice(0, 10) : "—"}</td>
                      <td><span className="status-badge">{r?.status === "posted" ? t("sales.linkPaymentModal.posted") : t("sales.linkPaymentModal.draft")}</span></td>
                      <td className="num">{fmt(Number(a.amount))}</td>
                      <td>
                        <button
                          className="icon-btn icon-btn-warn" title={t("sales.linkPaymentModal.unlink")} disabled={busy || !r}
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
            <h4 className="sub-head">{t("sales.linkPaymentModal.newLinkTitle")}</h4>
            <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 10 }}>
              <button className={mode === "existing" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("existing")}>{t("sales.linkPaymentModal.existingReceipt")}</button>
              <button className={mode === "new" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("new")}>{t("sales.linkPaymentModal.newReceipt")}</button>
            </div>

            {mode === "existing" ? (
              <div className="form-grid">
                <label>{t("sales.linkPaymentModal.receipt")}
                  <select value={selectedReceiptId} onChange={(e) => setSelectedReceiptId(e.target.value)}>
                    <option value="">{t("sales.linkPaymentModal.choose")}</option>
                    {candidateReceipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.receiptNumber} ({fmt(Number(r.totalAmount))} {currency} — {r.status === "posted" ? t("sales.linkPaymentModal.posted") : t("sales.linkPaymentModal.draft")})
                      </option>
                    ))}
                  </select>
                </label>
                <label>{t("sales.linkPaymentModal.allocatedAmount")}<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              </div>
            ) : (
              <div className="form-grid">
                <label>{t("sales.linkPaymentModal.receiptDate")}<input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></label>
                <label>{t("sales.linkPaymentModal.collectionMethod")}
                  <select value={newMethod} onChange={(e) => setNewMethod(e.target.value)}>
                    <option value="cash">{t("sales.linkPaymentModal.methodCash")}</option><option value="bank">{t("sales.linkPaymentModal.methodBank")}</option>
                  </select>
                </label>
                <label>{t("sales.linkPaymentModal.amount")}<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              </div>
            )}
            <div className="form-btn-group">
              <button className="btn-primary" disabled={busy} onClick={mode === "existing" ? linkExisting : linkNew}>
                {busy ? t("sales.linkPaymentModal.saving") : (mode === "existing" ? t("sales.linkPaymentModal.linkExisting") : t("sales.linkPaymentModal.createAndLink"))}
              </button>
            </div>
          </>
        )}

        <div className="form-btn-group" style={{ marginTop: 16 }}>
          <button className="btn-ghost" onClick={onClose}>{t("sales.linkPaymentModal.close2")}</button>
        </div>
      </div>
    </div>
  );
}
