import SalesReturnFormModal from "./SalesReturnFormModal";
import SendCreditNoteEmailModal from "./SendCreditNoteEmailModal";
import InvoiceZatcaDetails from "./InvoiceZatcaDetails";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PrintShell, QrImage, printWithOrientation, downloadBlob } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";
import { getAccountDisplayName } from "../shared/accountDisplayName";
import { useToast, ToastHost } from "../shared/Toast";
import { getSalesReturn, getSalesReturnPdfBlob, sendSalesReturnEmail } from "../../api/salesReturns";
import { currentFiscalYearStartDateOnly, todayDateOnly } from "../../shared/fiscalYear";
import { routes } from "../../routes";

// مطابق تماماً لـsubtypeForCustomer في src/lib/zatca/chain.ts (وSUBTYPE_EXPR في
// salesReturnsSearch.service.ts) — لا عمود مباشر على المردود نفسه، فيُشتَق هنا من نفس حقلي العميل.
function subtypeForCustomer(customer) {
  return customer?.customerType === "business" && customer?.vatNumber ? "standard" : "simplified";
}

/**
 * عرض إشعار الدائن للقراءة فقط + شريط إجراءات (تعديل للمسودة فقط، تحميل PDF، طباعة، إرسال
 * بالإيميل) — نفس بنية InvoiceViewModal.jsx بالضبط (راجعه لتبرير التصميم العام).
 */
export default function SalesReturnViewModal({ salesReturn, companies, autoPrint, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState(salesReturn);
  useEffect(() => setCurrent(salesReturn), [salesReturn]);
  const { toast, notify, dismiss } = useToast();
  const [editing, setEditing] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const company = companies?.find((c) => c.id === current.companyId) || current.company;

  useEffect(() => {
    const timer = autoPrint ? setTimeout(() => printWithOrientation(false), 200) : null;
    return () => timer && clearTimeout(timer);
  }, [autoPrint, current.id]);

  const refreshReturn = async () => {
    const fresh = await getSalesReturn(current.id);
    setCurrent(fresh);
    return fresh;
  };

  const handleDownload = async () => {
    try {
      const { blob, filename } = await getSalesReturnPdfBlob(current.id);
      downloadBlob(blob, filename || `credit-note-${current.returnNumber}.pdf`);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const handleSendEmail = async () => {
    if (current.customer?.email) {
      setSendingEmail(true);
      try {
        const result = await sendSalesReturnEmail(current.id);
        const message = result.sent
          ? t("sales.returns.notify.emailSent", { number: current.returnNumber, email: current.customer.email })
          : t("sales.returns.notify.emailFailed");
        notify(message, result.sent ? "success" : "error");
        onChanged?.(message);
      } catch (err) {
        notify(err.message, "error");
      } finally {
        setSendingEmail(false);
      }
      return;
    }
    setEmailModalOpen(true);
  };

  const customer = current.customer;
  const posted = current.status === "posted";
  const isDraft = current.status === "draft";
  const subtype = subtypeForCustomer(customer);
  const refundMethodLabel = t(`sales.returns.refund${current.refundMethod === "cash" ? "Cash" : current.refundMethod === "bank" ? "Bank" : "Account"}`);

  return (
    <>
      <ToastHost toast={toast} onDismiss={dismiss} />
      <PrintShell
        subtitle={t("sales.returns.view.subtitle")}
        company={company}
        refNode={
          <>
            <div>{t("sales.returns.view.returnNumber")}: <strong>{current.returnNumber}</strong></div>
            <div>{t("sales.returns.view.date")}: <strong>{current.date.slice(0, 10)}</strong></div>
          </>
        }
        onClose={onClose}
        onEdit={isDraft ? () => setEditing(true) : undefined}
        onDownload={posted ? handleDownload : undefined}
      >
        <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button type="button" className="btn-secondary" disabled={sendingEmail} onClick={handleSendEmail}>
            {customer?.email
              ? t("salesInvoices.actionsMenu.sendEmailTo", { email: customer.email })
              : t("salesInvoices.actionsMenu.sendEmailNoAddress")}
          </button>
        </div>

        <InvoiceZatcaDetails invoice={current} />

        <div className="voucher-meta">
          <div><span>{t("salesInvoices.view.seller")}</span><strong>{company?.name}</strong></div>
          <div>
            <span>{t("sales.returns.customer")}</span>
            <strong>
              {customer?.id ? (
                <Link
                  className="drill-link"
                  to={routes.customerStatement(customer.id, current.companyId, currentFiscalYearStartDateOnly(), todayDateOnly())}
                >
                  {customer.name}
                </Link>
              ) : customer?.name}
            </strong>
          </div>
          <div><span>{t("sales.returns.view.subtype")}</span><strong>{t(`salesInvoices.search.invoiceType${subtype === "standard" ? "Standard" : "Simplified"}`)}</strong></div>
          <div><span>{t("sales.returns.refundMethod")}</span><strong>{refundMethodLabel}</strong></div>
          {current.reason && <div><span>{t("sales.returns.reason")}</span><strong>{current.reason}</strong></div>}
          {current.relatedInvoice && (
            <div>
              <span>{t("sales.returns.originalInvoice")}</span>
              <strong>
                <Link className="drill-link" to={routes.invoiceByNumber(current.relatedInvoice.invoiceNumber)}>
                  {current.relatedInvoice.invoiceNumber}
                </Link>
                {" — "}{current.relatedInvoice.date.slice(0, 10)} — {fmt(Number(current.relatedInvoice.grandTotal))}
              </strong>
            </div>
          )}
        </div>

        <table className="ledger-table voucher-table">
          <thead>
            <tr>
              <th>{t("salesInvoices.view.table.description")}</th><th>{t("salesInvoices.view.table.quantity")}</th>
              <th>{t("salesInvoices.view.table.unitPrice")}</th><th>{t("salesInvoices.view.table.discount")}</th>
              <th>{t("salesInvoices.view.table.beforeTax")}</th><th>{t("salesInvoices.view.table.tax")}</th>
              <th>{t("salesInvoices.view.table.total")}</th>
            </tr>
          </thead>
          <tbody>
            {current.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.itemId ? (
                    <Link className="drill-link" to={routes.itemCard(l.itemId, current.companyId)}>
                      {l.description || getAccountDisplayName(l.account, i18n.language)}
                    </Link>
                  ) : (
                    l.description || getAccountDisplayName(l.account, i18n.language)
                  )}
                </td>
                <td className="num">{Number(l.quantity)}</td>
                <td className="num">{fmt2(Number(l.unitPrice))}</td>
                <td className="num">{Number(l.discountPct)}٪</td>
                <td className="num">{fmt(Number(l.subtotal))}</td>
                <td className="num">{fmt(Number(l.vat))}</td>
                <td className="num strong">{fmt(Number(l.total))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label" colSpan={4}>{t("journalEntries.form.total")}</td>
              <td className="num strong">{fmt(Number(current.subtotal))}</td>
              <td className="num strong">{fmt(Number(current.vatTotal))}</td>
              <td className="num strong">{fmt(Number(current.grandTotal))}</td>
            </tr>
          </tfoot>
        </table>

        <div className="qr-box">
          <div className="qr-box-label">{t("salesInvoices.view.qrLabel")}</div>
          <QrImage payload={current.qrPayload} />
          <details className="qr-details">
            <summary>{t("salesInvoices.view.qrPayloadSummary")}</summary>
            <div className="qr-box-payload">{current.qrPayload}</div>
          </details>
        </div>
      </PrintShell>

      {editing && (
        <SalesReturnFormModal
          companyId={current.companyId}
          companies={companies}
          editingReturn={current}
          onClose={() => setEditing(false)}
          onSaved={async (message) => { setEditing(false); await refreshReturn(); onChanged?.(message); onClose(); }}
        />
      )}

      {emailModalOpen && (
        <SendCreditNoteEmailModal
          salesReturn={current}
          onClose={() => setEmailModalOpen(false)}
          onSent={async (message) => { setEmailModalOpen(false); await refreshReturn(); onChanged?.(message); notify(message); }}
        />
      )}
    </>
  );
}
