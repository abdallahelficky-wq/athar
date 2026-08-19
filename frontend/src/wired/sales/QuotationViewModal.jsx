import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";

/**
 * عرض عرض السعر للقراءة فقط + إمكانية الطباعة/تحميل PDF عبر PrintShell المشترك (نفس
 * الهيدر/الفوتر الموحّد المستخدَم في فواتير المبيعات) — تُستخدَم من أيقونتي "عرض" و"طباعة"
 * في قائمة عروض الأسعار، وكذلك من زر "طباعة" داخل نافذة التعديل.
 */
export default function QuotationViewModal({ quotation, companies, autoPrint, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, quotation.id]);

  const company = companies?.find((c) => c.id === quotation.companyId) || quotation.company;
  const customer = quotation.customer;

  return (
    <PrintShell
      subtitle={t("sales.quotations.view.subtitle")}
      company={company}
      refNode={
        <>
          <div>{t("sales.quotations.view.quoteNumber")}: <strong>{quotation.quoteNumber}</strong></div>
          <div>{t("sales.quotations.view.date")}: <strong>{quotation.date.slice(0, 10)}</strong></div>
          {quotation.validUntil && <div>{t("sales.quotations.view.validUntil")}: <strong>{quotation.validUntil.slice(0, 10)}</strong></div>}
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>{t("sales.quotations.view.issuer")}</span><strong>{company?.name}</strong></div>
        <div><span>{t("sales.quotations.view.vatNumber")}</span><strong>{company?.vatNumber || t("sales.quotations.view.vatNotEntered")}</strong></div>
        <div><span>{t("sales.quotations.view.customer")}</span><strong>{customer?.name}</strong></div>
        <div><span>{t("sales.quotations.view.customerVat")}</span><strong>{customer?.vatNumber || t("sales.quotations.view.vatUnregistered")}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr>
            <th>{t("sales.quotations.view.table.description")}</th><th>{t("sales.quotations.view.table.quantity")}</th>
            <th>{t("sales.quotations.view.table.unitPrice")}</th><th>{t("sales.quotations.view.table.discount")}</th>
            <th>{t("sales.quotations.view.table.beforeTax")}</th><th>{t("sales.quotations.view.table.tax")}</th>
            <th>{t("sales.quotations.view.table.total")}</th>
          </tr>
        </thead>
        <tbody>
          {quotation.lines.map((l, idx) => (
            <tr key={idx}>
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
            <td className="foot-label" colSpan={4}>{t("sales.quotations.view.total")}</td>
            <td className="num strong">{fmt(Number(quotation.subtotal))}</td>
            <td className="num strong">{fmt(Number(quotation.vatTotal))}</td>
            <td className="num strong">{fmt(Number(quotation.grandTotal))}</td>
          </tr>
        </tfoot>
      </table>
      {quotation.status === "converted" && (
        <p className="note">{t("sales.quotations.view.alreadyConverted")}</p>
      )}
    </PrintShell>
  );
}
