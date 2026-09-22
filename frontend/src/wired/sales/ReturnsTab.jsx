import { useSearchParams, Link } from "react-router-dom";
import { listItems } from "../../api/items";
import ReturnLinesEditor from "./ReturnLinesEditor";
import { returnInvoiceLines } from "./returnInvoiceLines";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers } from "../../api/customers";
import { listAccounts } from "../../api/accounts";
import { listSalesInvoices, getSalesInvoice } from "../../api/salesInvoices";
import { listSalesReturns, createSalesReturn, unpostSalesReturn, retrySalesReturn, completeSalesReturn } from "../../api/salesReturns";
import { fmt } from "../../legacy/constants";
import { emptySalesLine as emptyInvoiceLine } from "./SalesInvoiceLinesEditor";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import { currencyLabel } from "../../shared/countries";
import { currentFiscalYearStartDateOnly, todayDateOnly } from "../../shared/fiscalYear";
import { routes } from "../../routes";

// حالة المردود أصبحت أربع قيم ممكنة منذ إصلاح مسار الترحيل الآمن على ثلاث مراحل لزاتكا، لا
// اثنتين فقط (posted/draft) — راجع نفس الشرح بالضبط في postingStatusLabel بملف InvoicesTab.jsx.
function postingStatusLabel(status, t) {
  if (status === "posted") return t("sales.returns.posted");
  if (status === "pending_submission") return t("sales.returns.pendingSubmission");
  if (status === "zatca_accepted_posting_incomplete") return t("sales.returns.postingIncomplete");
  return t("sales.returns.draft");
}

export default function ReturnsTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState("");
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setSelectedInvoice(null); setRelatedInvoiceId(""); setLines([emptyInvoiceLine()]); setError("");
    Promise.all([listCustomers(companyId), listAccounts({ companyId }), listSalesInvoices(companyId), listItems(companyId)])
      .then(([cs, accs, invs, loadedItems]) => {
        if (cancelled) return;
        setCustomers(cs); setAccounts(accs.filter((a) => a.type === "revenue")); setInvoices(invs); setItems(loadedItems);
        const id = searchParams.get("invoiceId");
        const invoice = invs.find((inv) => inv.id === id && inv.status === "posted");
        setCustomerId(invoice?.customerId || cs[0]?.id || "");
        if (invoice) { setRelatedInvoiceId(invoice.id); setRefundMethod("account"); }
        else if (id) setError(t("creditNote.unavailable"));
      }).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [companyId, searchParams.get("invoiceId")]);

  useEffect(() => {
    let cancelled = false;
    setSelectedInvoice(null); setError("");
    if (!relatedInvoiceId) { setLines([emptyInvoiceLine()]); setLoadingInvoice(false); return; }
    setLoadingInvoice(true); setLines([]);
    getSalesInvoice(relatedInvoiceId).then((invoice) => {
      if (cancelled) return;
      if (invoice.companyId !== companyId || invoice.customerId !== customerId || invoice.status !== "posted") throw new Error(t("creditNote.unavailable"));
      setSelectedInvoice(invoice); setLines(returnInvoiceLines(invoice));
    }).catch((e) => !cancelled && setError(e.message)).finally(() => !cancelled && setLoadingInvoice(false));
    return () => { cancelled = true; };
  }, [relatedInvoiceId, companyId, customerId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listSalesReturns(companyId).then(setReturns).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  // فاتورة أصلية غير مرحّلة (مسودة، أو بانتظار إرسال زاتكا، أو استُلم ردّها لكن لم يكتمل ترحيلها
  // المحلي بعد) لا يجوز ربط إشعار دائن بها — الخادم يرفض هذا صراحةً الآن، فتُستبعَد من القائمة هنا
  // حتى لا يظهر خيار سيُرفَض عند الحفظ.
  const customerInvoices = invoices.filter((i) => i.customerId === customerId && i.status === "posted");

  const save = async () => {
    if (!customerId || saving || loadingInvoice) return;
    if (relatedInvoiceId && (!selectedInvoice || !reason.trim())) { setError(t("creditNote.reasonRequired")); return; }
    setError(""); setMessage("");
    setSaving(true);
    try {
      const created = await createSalesReturn({
        companyId, customerId, relatedInvoiceId: relatedInvoiceId || undefined, date, reason, refundMethod,
        lines: lines.filter((l) => l.accountId && Number(l.quantity) > 0).map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) })),
      });
      setMessage(t(created.status === "posted" ? "creditNote.saved" : "creditNote.savedPending", { number: created.returnNumber }));
      setRelatedInvoiceId(""); setSelectedInvoice(null); setSearchParams({});
      setLines([emptyInvoiceLine()]);
      setReason("");
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resumeReturn = async (salesReturn) => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const updated = await (salesReturn.status === "pending_submission" ? retrySalesReturn(salesReturn.id) : completeSalesReturn(salesReturn.id));
      setMessage(t(updated.status === "posted" ? "creditNote.saved" : "creditNote.savedPending", { number: updated.returnNumber }));
      if (updated.rejectionReason) setError(updated.rejectionReason);
      reload();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const doUnpost = async (pin) => {
    await unpostSalesReturn(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>{t("sales.returns.customer")}
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setRelatedInvoiceId(""); }}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t("sales.returns.originalInvoice")}
            <select value={relatedInvoiceId} onChange={(e) => setRelatedInvoiceId(e.target.value)}>
              <option value="">{t("sales.returns.noLink")}</option>
              {customerInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber}</option>)}
            </select>
          </label>
          <label>{t("sales.returns.date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>{t("sales.returns.refundMethod")}
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="account">{t("sales.returns.refundAccount")}</option>
              <option value="cash">{t("sales.returns.refundCash")}</option>
              <option value="bank">{t("sales.returns.refundBank")}</option>
            </select>
          </label>
          <label className="memo-field">{t("sales.returns.reason")}<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>

        {loadingInvoice ? <p>{t("salesInvoices.loading")}</p> : <ReturnLinesEditor lines={lines} setLines={setLines} invoice={selectedInvoice} items={items} accounts={accounts} currency={currency} />}
        {selectedInvoice && <p>{t("creditNote.editHint")}</p>}
        {message && <p role="status">{message}</p>}
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={!customerId || saving || loadingInvoice || !lines.some((line) => Number(line.quantity) > 0) || (!!relatedInvoiceId && !selectedInvoice)}>{t("sales.returns.saveAndPost")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("sales.returns.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.returns.table.number")}</th><th>{t("sales.returns.table.customer")}</th>
                <th>{t("sales.returns.table.date")}</th><th>{t("sales.returns.table.total")}</th>
                <th>{t("sales.returns.table.status")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>{r.returnNumber}</td>
                    <td>
                      {r.customer?.id ? (
                        <Link
                          className="drill-link"
                          to={routes.customerStatement(r.customer.id, r.companyId, currentFiscalYearStartDateOnly(), todayDateOnly())}
                        >
                          {r.customer.name}
                        </Link>
                      ) : r.customer?.name}
                    </td>
                    <td>{r.date.slice(0, 10)}</td>
                    <td className="num">{fmt(r.grandTotal)}</td>
                    <td><span className="status-badge">{postingStatusLabel(r.status, t)}</span></td>
                    <td className="row-actions">
                      {["pending_submission", "zatca_accepted_posting_incomplete"].includes(r.status) && <button className="btn-secondary" disabled={saving} onClick={() => resumeReturn(r)}>{t(r.status === "pending_submission" ? "salesInvoices.zatcaSummary.resend" : "creditNote.complete")}</button>}
                      {r.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostTarget(r)}>{t("sales.returns.unpost")}</button>}
                      <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === r.id ? null : r.id)}>
                        {attachmentsFor === r.id ? t("sales.returns.attachmentsHide") : t("sales.returns.attachmentsShow")}
                      </button>
                    </td>
                  </tr>
                  {attachmentsFor === r.id && (
                    <tr><td colSpan={6}><AttachmentsPanel entityType="sales_return" entityId={r.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {returns.length === 0 && <tr><td className="empty" colSpan={6}>{t("sales.returns.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
    </div>
  );
}
