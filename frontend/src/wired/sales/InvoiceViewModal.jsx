import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, QrImage, printWithOrientation } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";
import { formatDateTime } from "../../i18n/dateFormat";
import { currencyLabel } from "../../shared/countries";

/**
 * عرض الفاتورة للقراءة فقط (بدون أي حقول قابلة للتعديل) + إمكانية الطباعة/تحميل PDF —
 * تُستخدَم من أيقونتي "عرض" و"طباعة" في قائمة الفواتير، وكذلك من زر "طباعة" داخل نافذة التعديل.
 */
export default function InvoiceViewModal({ invoice, companies, autoPrint, onClose }) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, invoice.id]);

  // نُفضّل بيانات الشركة الحالية (شعار/عنوان/رقم ضريبي محدَّث) من القائمة الحقيقية المحمَّلة
  // على مستوى التطبيق بدل النسخة المضمَّنة في الفاتورة (والتي لا تحمل logoUrl صالحاً أصلاً)
  const company = companies?.find((c) => c.id === invoice.companyId) || invoice.company;
  const customer = invoice.customer;
  const lastEmailLog = invoice.emailLogs?.[0];
  const branch = invoice.branch;
  const branchRate = branch?.exchangeRateToCompanyCurrency ? Number(branch.exchangeRateToCompanyCurrency) : null;
  const showBranchEquivalent = branch && company && branch.currency !== company.currency && branchRate;

  return (
    <PrintShell
      subtitle={invoice.invoiceType === "standard" ? t("salesInvoices.view.standardSubtitle") : t("salesInvoices.view.simplifiedSubtitle")}
      company={company}
      refNode={
        <>
          <div>{t("salesInvoices.view.invoiceNumber")}: <strong>{invoice.invoiceNumber}</strong></div>
          <div>{t("salesInvoices.view.date")}: <strong>{invoice.date.slice(0, 10)}</strong></div>
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>{t("salesInvoices.view.seller")}</span><strong>{company?.name}</strong></div>
        <div><span>{t("salesInvoices.view.sellerVat")}</span><strong>{company?.vatNumber || t("salesInvoices.view.vatNotEntered")}</strong></div>
        <div><span>{t("salesInvoices.view.customer")}</span><strong>{customer?.name}</strong></div>
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
          {invoice.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description || l.account?.name}</td>
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
            <td className="num strong">{fmt(Number(invoice.subtotal))}</td>
            <td className="num strong">{fmt(Number(invoice.vatTotal))}</td>
            <td className="num strong">{fmt(Number(invoice.grandTotal))}</td>
          </tr>
        </tfoot>
      </table>
      {showBranchEquivalent && (
        <p className="empty">
          {t("journalEntries.form.branchEquivalent", { amount: fmt(Number(invoice.grandTotal) / branchRate), currency: currencyLabel(branch.currency, i18n.language) })}
        </p>
      )}
      <div className="qr-box">
        <div className="qr-box-label">{t("salesInvoices.view.qrLabel")}</div>
        <QrImage payload={invoice.qrPayload} />
        <details className="qr-details">
          <summary>{t("salesInvoices.view.qrPayloadSummary")}</summary>
          <div className="qr-box-payload">{invoice.qrPayload}</div>
        </details>
      </div>
    </PrintShell>
  );
}
