import React, { useEffect, useState } from "react";
import { listSalesInvoices, deleteSalesInvoice, unpostSalesInvoice } from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import UnpostModal from "../shared/UnpostModal";
import InvoiceFormModal from "./InvoiceFormModal";
import InvoiceViewModal from "./InvoiceViewModal";
import JournalEntryViewModal from "./JournalEntryViewModal";
import LinkPaymentModal from "./LinkPaymentModal";
import PostedBlockModal from "./PostedBlockModal";

export default function InvoicesTab({ companyId, companies }) {
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

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listSalesInvoices(companyId).then(setInvoices).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  const onSaved = (message) => {
    setFormModal(null);
    reload();
    notify(message);
  };

  const onEditClick = (inv) => {
    if (inv.status === "posted") { setBlockModal({ invoice: inv, action: "تعديل" }); return; }
    setFormModal({ mode: "edit", invoice: inv });
  };

  const onDeleteClick = async (inv) => {
    if (inv.status === "posted") { setBlockModal({ invoice: inv, action: "حذف" }); return; }
    if (inv.receiptAllocations.length > 0) {
      notify("هذه الفاتورة مرتبطة بسند قبض — يجب فك الربط أولاً قبل الحذف.", "error");
      return;
    }
    if (!window.confirm(`حذف الفاتورة ${inv.invoiceNumber}؟`)) return;
    try {
      await deleteSalesInvoice(inv.id);
      reload();
      notify(`تم حذف الفاتورة ${inv.invoiceNumber}.`);
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
    notify(`تم فك ترحيل الفاتورة ${num}، وحُذف القيد المحاسبي المرتبط بها. أصبحت الآن مسودة.`);
  };

  const onUnpostedFromBlock = (updated) => {
    setBlockModal(null);
    reload();
    notify(`تم فك ترحيل الفاتورة ${updated.invoiceNumber}. أصبحت الآن مسودة ويمكنك المتابعة.`);
  };

  const onPrintClick = (inv) => {
    setViewInvoice(inv);
    setAutoPrint(true);
  };

  return (
    <div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
        <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>+ إضافة فاتورة</button>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>حالة الترحيل</th><th>حالة السداد</th><th>الإجراءات</th></tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const posted = inv.status === "posted";
                const linked = inv.receiptAllocations.length > 0;
                return (
                  <tr key={inv.id}>
                    <td>{inv.invoiceNumber}</td>
                    <td>{inv.customer?.name}</td>
                    <td>{inv.date.slice(0, 10)}</td>
                    <td className="num">{fmt(Number(inv.grandTotal))}</td>
                    <td><span className="status-badge">{posted ? "مرحّلة" : "مسودة"}</span></td>
                    <td><span className="status-badge">{inv.paymentStatus}</span></td>
                    <td className="row-actions">
                      <button className="icon-btn" title="عرض الفاتورة" onClick={() => setViewInvoice(inv)}><Icon.Eye /></button>
                      <button className="icon-btn" title="طباعة الفاتورة" onClick={() => onPrintClick(inv)}><Icon.Printer /></button>
                      <button className="icon-btn" title="تعديل الفاتورة" onClick={() => onEditClick(inv)}><Icon.Edit /></button>
                      <button className="icon-btn" title="نسخ الفاتورة (فاتورة جديدة بنفس البيانات)" onClick={() => onDuplicateClick(inv)}><Icon.Copy /></button>
                      <button
                        className="icon-btn"
                        title={!posted && !linked ? "رحّل الفاتورة أولاً لتتمكن من ربطها بسند قبض" : linked ? "فك ربط سند القبض" : "ربط بسند قبض"}
                        disabled={!posted && !linked}
                        onClick={() => setLinkPaymentInvoice(inv)}
                      >
                        {linked ? <Icon.Unlink /> : <Icon.Link />}
                      </button>
                      <button
                        className="icon-btn"
                        title={posted ? "عرض القيد المحاسبي" : "لا يوجد قيد بعد — الفاتورة مسودة"}
                        disabled={!posted}
                        onClick={() => setJournalInvoice(inv)}
                      ><Icon.BookOpen /></button>
                      {posted && <button className="icon-btn icon-btn-warn" title="فك الترحيل" onClick={() => setUnpostTarget(inv)}><Icon.Unlock /></button>}
                      <button className="icon-btn icon-btn-danger" title="حذف الفاتورة" onClick={() => onDeleteClick(inv)}><Icon.Trash /></button>
                    </td>
                  </tr>
                );
              })}
              {invoices.length === 0 && <tr><td className="empty" colSpan={7}>لا توجد فواتير بعد.</td></tr>}
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

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
