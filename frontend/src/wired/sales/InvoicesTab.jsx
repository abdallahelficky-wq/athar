import React, { useEffect, useState } from "react";
import { listSalesInvoices, deleteSalesInvoice, unpostSalesInvoice, sendInvoiceEmail, resendInvoiceZatca } from "../../api/salesInvoices";
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

// نفس قيم ZatcaDocumentStatus المخزَّنة على الفاتورة في الباك اند — لا حقل/منطق جديد، فقط عرضها.
const ZATCA_STATUS_BADGE = {
  not_applicable: { label: "غير منطبق", className: "status-badge status-neutral" },
  pending_clearance: { label: "قيد الإرسال", className: "status-badge status-saved" },
  pending_reporting: { label: "قيد الإرسال", className: "status-badge status-saved" },
  cleared: { label: "مُرسلة/مقبولة", className: "status-badge status-posted" },
  reported: { label: "مُرسلة/مقبولة", className: "status-badge status-posted" },
  rejected: { label: "مرفوضة", className: "status-badge status-rejected" },
};

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

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  // العمود/الفلتر يظهران فقط للشركات المفعَّلة على زاتكا — لغيرها كل الفواتير "غير منطبق" ثابتة
  // فلا داعي لإرباك الشاشة بعمود لا معنى له.
  const activeCompany = companies?.find((c) => c.id === companyId);
  const zatcaApplicable = activeCompany?.zatcaOnboardingStatus && activeCompany.zatcaOnboardingStatus !== "not_onboarded";
  const visibleInvoices = zatcaApplicable && zatcaStatusFilter ? invoices.filter((inv) => inv.zatcaStatus === zatcaStatusFilter) : invoices;

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

  const onSendEmailClick = async (inv) => {
    if (inv.customer?.email) {
      setSendingEmailId(inv.id);
      try {
        const result = await sendInvoiceEmail(inv.id);
        reload();
        notify(result.sent ? `تم إرسال الفاتورة ${inv.invoiceNumber} إلى ${inv.customer.email}.` : "تعذّر إرسال الفاتورة — حاول مرة أخرى لاحقاً.", result.sent ? "success" : "error");
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
    setResendingZatcaId(inv.id);
    try {
      const updated = await resendInvoiceZatca(inv.id);
      reload();
      const badge = ZATCA_STATUS_BADGE[updated.zatcaStatus];
      notify(
        updated.zatcaStatus === "rejected"
          ? `أعيد رفض الفاتورة ${inv.invoiceNumber} من زاتكا${updated.rejectionReason ? `: ${updated.rejectionReason}` : "."}`
          : `تم إرسال الفاتورة ${inv.invoiceNumber} بنجاح — الحالة الآن "${badge?.label || updated.zatcaStatus}".`,
        updated.zatcaStatus === "rejected" ? "error" : "success",
      );
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setResendingZatcaId(null);
    }
  };

  const colSpan = zatcaApplicable ? 8 : 7;

  return (
    <div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
        <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>+ إضافة فاتورة</button>
      </div>

      {zatcaApplicable && (
        <form className="filter-bar" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 14 }}>
          <label>
            حالة زاتكا
            <select value={zatcaStatusFilter} onChange={(e) => setZatcaStatusFilter(e.target.value)}>
              <option value="">— الكل —</option>
              <option value="not_applicable">غير منطبق</option>
              <option value="pending_clearance">قيد الإرسال (قياسية)</option>
              <option value="pending_reporting">قيد الإرسال (مبسّطة)</option>
              <option value="cleared">مُرسلة/مقبولة (قياسية)</option>
              <option value="reported">مُرسلة/مقبولة (مبسّطة)</option>
              <option value="rejected">مرفوضة/فشل الإرسال</option>
            </select>
          </label>
        </form>
      )}

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table responsive-table">
            <thead>
              <tr>
                <th>الرقم</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>حالة الترحيل</th><th>حالة السداد</th>
                {zatcaApplicable && <th>حالة زاتكا</th>}
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visibleInvoices.map((inv) => {
                const posted = inv.status === "posted";
                const linked = inv.receiptAllocations.length > 0;
                const zatcaBadge = ZATCA_STATUS_BADGE[inv.zatcaStatus] || ZATCA_STATUS_BADGE.not_applicable;
                const zatcaRejected = inv.zatcaStatus === "rejected";
                return (
                  <tr key={inv.id}>
                    <td data-label="الرقم">{inv.invoiceNumber}</td>
                    <td data-label="العميل">{inv.customer?.name}</td>
                    <td data-label="التاريخ">{inv.date.slice(0, 10)}</td>
                    <td className="num" data-label="الإجمالي">{fmt(Number(inv.grandTotal))}</td>
                    <td data-label="حالة الترحيل"><span className="status-badge">{posted ? "مرحّلة" : "مسودة"}</span></td>
                    <td data-label="حالة السداد"><span className="status-badge">{inv.paymentStatus}</span></td>
                    {zatcaApplicable && (
                      <td data-label="حالة زاتكا">
                        <span className={zatcaBadge.className} title={zatcaRejected && inv.zatcaResponseRaw ? JSON.stringify(inv.zatcaResponseRaw) : undefined}>
                          {zatcaBadge.label}
                        </span>
                      </td>
                    )}
                    <td className="row-actions">
                      <button className="icon-btn" title="عرض الفاتورة" onClick={() => setViewInvoice(inv)}><Icon.Eye /></button>
                      <button className="icon-btn" title="تعديل الفاتورة" onClick={() => onEditClick(inv)}><Icon.Edit /></button>
                      {posted && <button className="icon-btn icon-btn-warn" title="فك الترحيل" onClick={() => setUnpostTarget(inv)}><Icon.Unlock /></button>}
                      {zatcaRejected && (
                        <button
                          className="icon-btn icon-btn-warn"
                          title={resendingZatcaId === inv.id ? "قيد الإرسال..." : "إعادة إرسال الفاتورة لزاتكا"}
                          disabled={resendingZatcaId === inv.id}
                          onClick={() => onResendZatcaClick(inv)}
                        ><Icon.Refresh /></button>
                      )}
                      <button className="icon-btn icon-btn-danger" title="حذف الفاتورة" onClick={() => onDeleteClick(inv)}><Icon.Trash /></button>
                      <ActionsMenu
                        items={[
                          { label: "طباعة الفاتورة", icon: Icon.Printer, onClick: () => onPrintClick(inv) },
                          { label: "نسخ الفاتورة (فاتورة جديدة بنفس البيانات)", icon: Icon.Copy, onClick: () => onDuplicateClick(inv) },
                          {
                            label: linked ? "فك ربط سند القبض" : "ربط بسند قبض",
                            icon: linked ? Icon.Unlink : Icon.Link,
                            onClick: () => setLinkPaymentInvoice(inv),
                            disabled: !posted && !linked,
                          },
                          { label: "عرض القيد المحاسبي", icon: Icon.BookOpen, onClick: () => setJournalInvoice(inv), disabled: !posted },
                          {
                            label: inv.customer?.email ? `إرسال بالإيميل إلى ${inv.customer.email}` : "إرسال بالإيميل (لا يوجد بريد مسجَّل)",
                            icon: Icon.Mail,
                            onClick: () => onSendEmailClick(inv),
                            disabled: !posted || sendingEmailId === inv.id,
                          },
                          {
                            label: "إعادة طباعة كإيصال حراري (58/80مم)",
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
              {visibleInvoices.length === 0 && <tr><td className="empty" colSpan={colSpan}>لا توجد فواتير بعد.</td></tr>}
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
