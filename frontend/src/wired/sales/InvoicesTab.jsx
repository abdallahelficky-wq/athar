import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listSalesInvoices, deleteSalesInvoice, unpostSalesInvoice, sendInvoiceEmail, resendInvoiceZatca, retryInvoiceZatcaSubmission } from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import UnpostModal from "../shared/UnpostModal";
import ActionsMenu from "../shared/ActionsMenu";
import InvoiceFormModal from "./InvoiceFormModal";
import InvoiceViewModal from "./InvoiceViewModal";
import JournalEntryViewModal from "./JournalEntryViewModal";
import LinkPaymentModal from "./LinkPaymentModal";
import PostedBlockModal from "./PostedBlockModal";
import SendInvoiceEmailModal from "./SendInvoiceEmailModal";
import ReprintReceiptModal from "./ReprintReceiptModal";

import { invoiceZatcaState } from "./invoiceZatcaState";
const STATUS_OPTIONS = ["sent", "sent_with_notes", "not_sent", "not_applicable"];

// حالة الفاتورة أصبحت أربع قيم ممكنة منذ إصلاح مسار الترحيل الآمن على ثلاث مراحل لزاتكا، لا
// اثنتين فقط (posted/draft) كما كانت — pending_submission وzatca_accepted_posting_incomplete
// عطل إنتاج فعلي كانا سيُعرَضان خطأً كـ"مسودة" لو استُخدم فحص ثنائي بسيط هنا (posted ? .. : draft)،
// موهماً بأن الفاتورة لم تُرقَّم/تُحجز لها سلسلة زاتكا بعد بينما هي فعلياً محجوزة ومُرسَلة أو
// مُستلَم ردّها بالفعل، فقط الترحيل المحلي (قيد/مخزون) لم يكتمل.
function postingStatusLabel(status, t) {
  if (status === "posted") return t("salesInvoices.table.posted");
  if (status === "pending_submission") return t("salesInvoices.table.pendingSubmission");
  if (status === "zatca_accepted_posting_incomplete") return t("salesInvoices.table.postingIncomplete");
  return t("salesInvoices.table.draft");
}

export default function InvoicesTab({ companyId, companies }) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();

  const [formModal, setFormModal] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [journalInvoice, setJournalInvoice] = useState(null);
  const [linkPaymentInvoice, setLinkPaymentInvoice] = useState(null);
  const [blockModal, setBlockModal] = useState(null);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [emailModalInvoice, setEmailModalInvoice] = useState(null);
  const [sendingEmailId, setSendingEmailId] = useState(null);
  const [resendingZatcaId, setResendingZatcaId] = useState(null);
  const [zatcaStatusFilter, setZatcaStatusFilter] = useState("");
  const [reprintInvoice, setReprintInvoice] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listSalesInvoices(companyId).then(setInvoices).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  if (!companyId) return <p className="empty">{t("salesInvoices.noCompany")}</p>;

  const visibleInvoices = zatcaStatusFilter ? invoices.filter((inv) => invoiceZatcaState(inv).key === zatcaStatusFilter) : invoices;

  const onSaved = (message) => {
    setFormModal(null);
    reload();
    notify(message);
  };

  const onEditClick = (inv) => {
    if (inv.status === "posted") { setBlockModal({ invoice: inv, action: t("salesInvoices.blockAction.edit") }); return; }
    setFormModal({ mode: "edit", invoice: inv });
  };

  const onDeleteClick = async (inv) => {
    if (inv.status === "posted") { setBlockModal({ invoice: inv, action: t("salesInvoices.blockAction.delete") }); return; }
    if (inv.receiptAllocations.length > 0) {
      notify(t("salesInvoices.notify.linkedToReceipt"), "error");
      return;
    }
    if (!window.confirm(t("salesInvoices.notify.confirmDelete", { number: inv.invoiceNumber }))) return;
    try {
      await deleteSalesInvoice(inv.id);
      reload();
      notify(t("salesInvoices.notify.deleted", { number: inv.invoiceNumber }));
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const onDuplicateClick = (inv) => setFormModal({ mode: "duplicate", invoice: inv });

  const doUnpost = async (pin) => {
    await unpostSalesInvoice(unpostTarget.id, pin);
    const num = unpostTarget.invoiceNumber;
    setUnpostTarget(null);
    reload();
    notify(t("salesInvoices.notify.unposted", { number: num }));
  };

  const onUnpostedFromBlock = (updated) => {
    setBlockModal(null);
    reload();
    notify(t("salesInvoices.notify.unpostedFromBlock", { number: updated.invoiceNumber }));
  };

  const onPrintClick = (inv) => {
    setViewInvoice(inv);
    setAutoPrint(true);
  };

  const onSendEmailClick = async (inv) => {
    if (inv.customer?.email) {
      setSendingEmailId(inv.id);
      try {
        const result = await sendInvoiceEmail(inv.id);
        reload();
        notify(
          result.sent ? t("salesInvoices.notify.emailSent", { number: inv.invoiceNumber, email: inv.customer.email }) : t("salesInvoices.notify.emailFailed"),
          result.sent ? "success" : "error",
        );
      } catch (err) {
        notify(err.message, "error");
      } finally {
        setSendingEmailId(null);
      }
      return;
    }
    setEmailModalInvoice(inv);
  };

  const onResendZatcaClick = async (inv) => {
    if (resendingZatcaId) return;
    setResendingZatcaId(inv.id);
    try {
      const updated = await (inv.status === "pending_submission" ? retryInvoiceZatcaSubmission(inv.id) : resendInvoiceZatca(inv.id));
      reload();
      const badgeLabel = t(`salesInvoices.zatcaSummary.${invoiceZatcaState(updated).key}`);
      const stillFailing = !["sent", "sent_with_notes"].includes(invoiceZatcaState(updated).key);
      notify(
        updated.zatcaStatus === "submission_failed"
          ? t("salesInvoices.notify.zatcaStillUnreachable", { number: inv.invoiceNumber })
          : updated.zatcaStatus === "certificate_error"
            ? t("salesInvoices.notify.zatcaCertificateStillInvalid", { number: inv.invoiceNumber })
            : updated.zatcaStatus === "compliance_checked"
              ? t("salesInvoices.notify.zatcaStillComplianceOnly", { number: inv.invoiceNumber })
              : stillFailing
                ? t("salesInvoices.notify.zatcaRejectedAgain", { number: inv.invoiceNumber, reason: updated.rejectionReason ? `: ${updated.rejectionReason}` : "." })
                : t("salesInvoices.notify.zatcaResentOk", { number: inv.invoiceNumber, status: badgeLabel }),
        stillFailing && updated.zatcaStatus !== "compliance_checked" ? "error" : "success",
      );
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setResendingZatcaId(null);
    }
  };

  const colSpan = 8;

  return (
    <div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
        <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>{t("salesInvoices.addInvoice")}</button>
      </div>

      <form className="filter-bar" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 14 }}>
          <label>
            {t("salesInvoices.zatcaStatusFilterLabel")}
            <select value={zatcaStatusFilter} onChange={(e) => setZatcaStatusFilter(e.target.value)}>
              <option value="">{t("common.allOption")}</option>
              {STATUS_OPTIONS.map((key) => (
                <option key={key} value={key}>{t(`salesInvoices.zatcaSummary.${key}`)}</option>
              ))}
            </select>
          </label>
      </form>

      {loading ? <p className="empty">{t("salesInvoices.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table responsive-table">
            <thead>
              <tr>
                <th>{t("salesInvoices.table.number")}</th><th>{t("salesInvoices.table.customer")}</th>
                <th>{t("salesInvoices.table.date")}</th><th>{t("salesInvoices.table.total")}</th>
                <th>{t("salesInvoices.table.postingStatus")}</th><th>{t("salesInvoices.table.paymentStatus")}</th>
                <th>{t("salesInvoices.table.zatcaStatus")}</th>
                <th>{t("salesInvoices.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleInvoices.map((inv) => {
                const posted = inv.status === "posted";
                const linked = inv.receiptAllocations.length > 0;
                const zatca = invoiceZatcaState(inv);
                return (
                  <tr key={inv.id} style={Number(inv.returnedAmount) > 0 ? { background: "#fff7ed" } : undefined}>
                    <td data-label={t("salesInvoices.table.number")}>{inv.invoiceNumber}{inv.creditNotes?.some((note) => note.status !== "posted" && note.status !== "draft") && <div className="status-badge status-warning">↩ {t("creditNote.pending")}</div>}{Number(inv.returnedAmount) > 0 && <div><span className="status-badge status-warning">↩ {t(inv.returnStatus === "full" ? "creditNote.full" : "creditNote.partial")}</span></div>}</td>
                    <td data-label={t("salesInvoices.table.customer")}>{inv.customer?.name}</td>
                    <td data-label={t("salesInvoices.table.date")}>{inv.date.slice(0, 10)}</td>
                    <td className="num" data-label={t("salesInvoices.table.total")}>{fmt(Number(inv.grandTotal))}{Number(inv.returnedAmount) > 0 && <div>{t("creditNote.net")}: {fmt(Number(inv.netGrandTotal))}</div>}</td>
                    <td data-label={t("salesInvoices.table.postingStatus")}><span className="status-badge">{postingStatusLabel(inv.status, t)}</span></td>
                    <td data-label={t("salesInvoices.table.paymentStatus")}><span className="status-badge">{inv.paymentStatus}</span></td>
                    <td data-label={t("salesInvoices.table.zatcaStatus")}>
                        <button type="button" className={zatca.className} onClick={() => setViewInvoice(inv)}>
                          {t(`salesInvoices.zatcaSummary.${zatca.key}`)}
                        </button>
                        {zatca.canResend && <button type="button" className="btn-secondary" disabled={!!resendingZatcaId} onClick={() => onResendZatcaClick(inv)}>
                          {t(resendingZatcaId === inv.id ? "salesInvoices.zatcaSummary.sending" : "salesInvoices.zatcaSummary.resend")}
                        </button>}
                    </td>
                    <td className="row-actions">
                      <button className="icon-btn" title={t("salesInvoices.actionsMenu.view")} onClick={() => setViewInvoice(inv)}><Icon.Eye /></button>
                      <button className="icon-btn" title={t("salesInvoices.actionsMenu.edit")} onClick={() => onEditClick(inv)}><Icon.Edit /></button>
                      {posted && <button className="icon-btn icon-btn-warn" title={t("salesInvoices.actionsMenu.unpost")} onClick={() => setUnpostTarget(inv)}><Icon.Unlock /></button>}
                      <button className="icon-btn icon-btn-danger" title={t("salesInvoices.actionsMenu.delete")} onClick={() => onDeleteClick(inv)}><Icon.Trash /></button>
                      <ActionsMenu
                        items={[
                          { label: t("salesInvoices.actionsMenu.print"), icon: Icon.Printer, onClick: () => onPrintClick(inv) },
                          { label: t("salesInvoices.actionsMenu.duplicate"), icon: Icon.Copy, onClick: () => onDuplicateClick(inv) },
                          {
                            label: linked ? t("salesInvoices.actionsMenu.unlinkReceipt") : t("salesInvoices.actionsMenu.linkReceipt"),
                            icon: linked ? Icon.Unlink : Icon.Link,
                            onClick: () => setLinkPaymentInvoice(inv),
                            disabled: !posted && !linked,
                          },
                          { label: t("salesInvoices.actionsMenu.viewJournalEntry"), icon: Icon.BookOpen, onClick: () => setJournalInvoice(inv), disabled: !posted },
                          {
                            label: inv.customer?.email ? t("salesInvoices.actionsMenu.sendEmailTo", { email: inv.customer.email }) : t("salesInvoices.actionsMenu.sendEmailNoAddress"),
                            icon: Icon.Mail,
                            onClick: () => onSendEmailClick(inv),
                            disabled: !posted || sendingEmailId === inv.id,
                          },
                          {
                            label: t("salesInvoices.actionsMenu.reprintReceipt"),
                            icon: Icon.Receipt,
                            onClick: () => setReprintInvoice(inv),
                            disabled: !posted,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {visibleInvoices.length === 0 && <tr><td className="empty" colSpan={colSpan}>{t("salesInvoices.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {formModal && (
        <InvoiceFormModal
          companyId={companyId}
          companies={companies}
          editingInvoice={formModal.mode === "edit" ? formModal.invoice : null}
          duplicateFrom={formModal.mode === "duplicate" ? formModal.invoice : null}
          onClose={() => setFormModal(null)}
          onSaved={onSaved}
        />
      )}

      {viewInvoice && (
        <InvoiceViewModal
          invoice={viewInvoice}
          companies={companies}
          autoPrint={autoPrint}
          onClose={() => { setViewInvoice(null); setAutoPrint(false); }}
        />
      )}

      {journalInvoice && (
        <JournalEntryViewModal journalEntryId={journalInvoice.journalEntryId} onClose={() => setJournalInvoice(null)} />
      )}

      {linkPaymentInvoice && (
        <LinkPaymentModal
          invoice={linkPaymentInvoice}
          companyId={companyId}
          onClose={() => setLinkPaymentInvoice(null)}
          onChanged={(message) => { reload(); notify(message); }}
        />
      )}

      {blockModal && (
        <PostedBlockModal
          invoiceId={blockModal.invoice.id}
          invoiceNumber={blockModal.invoice.invoiceNumber}
          action={blockModal.action}
          onClose={() => setBlockModal(null)}
          onUnposted={onUnpostedFromBlock}
        />
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}

      {emailModalInvoice && (
        <SendInvoiceEmailModal
          invoice={emailModalInvoice}
          onClose={() => setEmailModalInvoice(null)}
          onSent={(message) => { setEmailModalInvoice(null); reload(); notify(message); }}
        />
      )}

      {reprintInvoice && (
        <ReprintReceiptModal
          invoice={reprintInvoice}
          company={companies?.find((c) => c.id === reprintInvoice.companyId) || reprintInvoice.company}
          onClose={() => setReprintInvoice(null)}
        />
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
