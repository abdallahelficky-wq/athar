import InvoiceCreditNotes from "./InvoiceCreditNotes";
import InvoiceZatcaDetails from "./InvoiceZatcaDetails";
import InvoiceFormModal from "./InvoiceFormModal";
import LinkPaymentModal from "./LinkPaymentModal";
import SendInvoiceEmailModal from "./SendInvoiceEmailModal";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PrintShell, QrImage, printWithOrientation, downloadBlob } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";
import { formatDateTime } from "../../i18n/dateFormat";
import { currencyLabel } from "../../shared/countries";
import { currentFiscalYearStartDateOnly, todayDateOnly } from "../../shared/fiscalYear";
import { getAccountDisplayName } from "../shared/accountDisplayName";
import { useToast, ToastHost } from "../shared/Toast";
import { getSalesInvoice, getSalesInvoicePdfBlob, sendInvoiceEmail } from "../../api/salesInvoices";
import { routes } from "../../routes";
import ClassicProInvoiceView from "./invoiceTemplates/ClassicProInvoiceView";

/**
 * عرض الفاتورة للقراءة فقط + شريط إجراءات (تعديل للمسودة فقط، تحميل PDF الحقيقي، طباعة، إرسال
 * بالإيميل، تسجيل سند قبض، إصدار إشعار دائن) + روابط تفصيلية (اسم العميل ← كشف حسابه، كل سطر صنف ←
 * كرت الصنف) — تُستخدَم من أيقونتي "عرض" و"طباعة" في قائمة الفواتير، وكذلك من زر "طباعة" داخل
 * نافذة التعديل. قالب الفاتورة المعروض يتبع Company.invoiceTemplate لهذه الفاتورة تحديداً —
 * "classicPro" يُفوَّض كلياً لمكوّن منفصل (ClassicProInvoiceView، بلا شريط الإجراءات الجديد هنا
 * بعد)، وبقية القيم ("modern"، الافتراضي) تستمر بنفس التصميم الحالي أدناه.
 */
export default function InvoiceViewModal({ invoice, companies, autoPrint, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState(invoice);
  useEffect(() => setCurrent(invoice), [invoice]);
  const { toast, notify, dismiss } = useToast();
  const [editing, setEditing] = useState(false);
  const [linkingPayment, setLinkingPayment] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const companyForTemplate = companies?.find((c) => c.id === current.companyId) || current.company;
  useEffect(() => {
    if (!autoPrint || companyForTemplate?.invoiceTemplate === "classicPro") return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, current.id, companyForTemplate?.invoiceTemplate]);

  if (companyForTemplate?.invoiceTemplate === "classicPro") {
    return <ClassicProInvoiceView invoice={current} companies={companies} autoPrint={autoPrint} onClose={onClose} />;
  }

  const refreshInvoice = async () => {
    const fresh = await getSalesInvoice(current.id);
    setCurrent(fresh);
    return fresh;
  };

  const handleDownload = async () => {
    try {
      const { blob, filename } = await getSalesInvoicePdfBlob(current.id);
      downloadBlob(blob, filename || `invoice-${current.invoiceNumber}.pdf`);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const handleSendEmail = async () => {
    if (current.customer?.email) {
      setSendingEmail(true);
      try {
        const result = await sendInvoiceEmail(current.id);
        await refreshInvoice();
        notify(
          result.sent
            ? t("salesInvoices.notify.emailSent", { number: current.invoiceNumber, email: current.customer.email })
            : t("salesInvoices.notify.emailFailed"),
          result.sent ? "success" : "error",
        );
        onChanged?.(result.sent ? t("salesInvoices.notify.emailSent", { number: current.invoiceNumber, email: current.customer.email }) : t("salesInvoices.notify.emailFailed"));
      } catch (err) {
        notify(err.message, "error");
      } finally {
        setSendingEmail(false);
      }
      return;
    }
    setEmailModalOpen(true);
  };

  // نُفضّل بيانات الشركة الحالية (شعار/عنوان/رقم ضريبي محدَّث) من القائمة الحقيقية المحمَّلة
  // على مستوى التطبيق بدل النسخة المضمَّنة في الفاتورة (والتي لا تحمل logoUrl صالحاً أصلاً)
  const company = companyForTemplate;
  const customer = current.customer;
  const lastEmailLog = current.emailLogs?.[0];
  const branch = current.branch;
  const branchRate = branch?.exchangeRateToCompanyCurrency ? Number(branch.exchangeRateToCompanyCurrency) : null;
  const showBranchEquivalent = branch && company && branch.currency !== company.currency && branchRate;

  const posted = current.status === "posted";
  const isDraft = current.status === "draft";
  const paid = (current.receiptAllocations || []).reduce((s, a) => s + Number(a.amount), 0);
  const due = Math.max(0, Number(current.grandTotal) - Number(current.accountCreditAmount || 0) - paid);

  return (
    <>
      <ToastHost toast={toast} onDismiss={dismiss} />
      <PrintShell
        subtitle={current.invoiceType === "standard" ? t("salesInvoices.view.standardSubtitle") : t("salesInvoices.view.simplifiedSubtitle")}
        company={company}
        refNode={
          <>
            <div>{t("salesInvoices.view.invoiceNumber")}: <strong>{current.invoiceNumber}</strong></div>
            <div>{t("salesInvoices.view.date")}: <strong>{current.date.slice(0, 10)}</strong></div>
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
        {posted && due > 0.5 && (
          <button type="button" className="btn-secondary" onClick={() => setLinkingPayment(true)}>
            {t("salesInvoices.actionsMenu.linkReceipt")}
          </button>
        )}
      </div>
      <InvoiceZatcaDetails invoice={current} />
      <div className="voucher-meta">
        <div><span>{t("salesInvoices.view.seller")}</span><strong>{company?.name}</strong></div>
        <div><span>{t("salesInvoices.view.sellerVat")}</span><strong>{company?.vatNumber || t("salesInvoices.view.vatNotEntered")}</strong></div>
        <div>
          <span>{t("salesInvoices.view.customer")}</span>
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
        <div><span>{t("salesInvoices.view.customerVat")}</span><strong>{customer?.vatNumber || t("salesInvoices.view.vatUnregistered")}</strong></div>
        {branch && (
          <div><span>{t("journalEntries.form.branchLabel")}</span><strong>{branch.nameAr}</strong></div>
        )}
        {lastEmailLog && (
          <div>
            <span>{t("salesInvoices.view.lastEmail")}</span>
            <strong>
              {formatDateTime(lastEmailLog.createdAt, i18n.language)} — {t("salesInvoices.view.sentTo")} {lastEmailLog.sentTo}
              {!lastEmailLog.success && ` ${t("salesInvoices.view.emailFailed")}`}
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
      {showBranchEquivalent && (
        <p className="empty">
          {t("journalEntries.form.branchEquivalent", { amount: fmt(Number(current.grandTotal) / branchRate), currency: currencyLabel(branch.currency, i18n.language) })}
        </p>
      )}
      <div className="qr-box">
        <div className="qr-box-label">{t("salesInvoices.view.qrLabel")}</div>
        <QrImage payload={current.qrPayload} />
        <details className="qr-details">
          <summary>{t("salesInvoices.view.qrPayloadSummary")}</summary>
          <div className="qr-box-payload">{current.qrPayload}</div>
        </details>
      </div>
      <InvoiceCreditNotes invoice={current} onClose={onClose} />
    </PrintShell>

      {editing && (
        <InvoiceFormModal
          companyId={current.companyId}
          companies={companies}
          editingInvoice={current}
          onClose={() => setEditing(false)}
          onSaved={(message) => { setEditing(false); onChanged?.(message); onClose(); }}
        />
      )}

      {linkingPayment && (
        <LinkPaymentModal
          invoice={current}
          companyId={current.companyId}
          onClose={() => setLinkingPayment(false)}
          onChanged={async (message) => { await refreshInvoice(); onChanged?.(message); notify(message); }}
        />
      )}

      {emailModalOpen && (
        <SendInvoiceEmailModal
          invoice={current}
          onClose={() => setEmailModalOpen(false)}
          onSent={async (message) => { setEmailModalOpen(false); await refreshInvoice(); onChanged?.(message); notify(message); }}
        />
      )}
    </>
  );
}
