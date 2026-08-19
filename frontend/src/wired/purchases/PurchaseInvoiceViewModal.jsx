import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";

/** عرض فاتورة المشتريات للقراءة فقط + طباعة/تحميل PDF — يستخدم PrintShell المشترك فيرث هيدر/فوتر الشركة تلقائياً */
export default function PurchaseInvoiceViewModal({ invoice, companies, autoPrint, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, invoice.id]);

  const company = companies?.find((c) => c.id === invoice.companyId) || invoice.company;
  const supplier = invoice.supplier;

  return (
    <PrintShell
      subtitle={t("purchases.invoices.view.subtitle")}
      company={company}
      refNode={
        <>
          <div>{t("purchases.invoices.view.invoiceNumber")}: <strong>{invoice.invoiceNumber}</strong></div>
          <div>{t("purchases.invoices.view.date")}: <strong>{invoice.date.slice(0, 10)}</strong></div>
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>{t("purchases.invoices.view.buyer")}</span><strong>{company?.name}</strong></div>
        <div><span>{t("purchases.invoices.view.buyerVat")}</span><strong>{company?.vatNumber || t("purchases.invoices.view.vatNotEntered")}</strong></div>
        <div><span>{t("purchases.invoices.view.supplier")}</span><strong>{supplier?.name}</strong></div>
        <div><span>{t("purchases.invoices.view.supplierVat")}</span><strong>{supplier?.vatNumber || t("purchases.invoices.view.vatUnregistered")}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr>
            <th>{t("purchases.invoices.view.table.description")}</th><th>{t("purchases.invoices.view.table.quantity")}</th>
            <th>{t("purchases.invoices.view.table.unitPrice")}</th><th>{t("purchases.invoices.view.table.discount")}</th>
            <th>{t("purchases.invoices.view.table.beforeTax")}</th><th>{t("purchases.invoices.view.table.tax")}</th>
            <th>{t("purchases.invoices.view.table.total")}</th>
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
            <td className="foot-label" colSpan={4}>{t("purchases.invoices.view.total")}</td>
            <td className="num strong">{fmt(Number(invoice.subtotal))}</td>
            <td className="num strong">{fmt(Number(invoice.vatTotal))}</td>
            <td className="num strong">{fmt(Number(invoice.grandTotal))}</td>
          </tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
