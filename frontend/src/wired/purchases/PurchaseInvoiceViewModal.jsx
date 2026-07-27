import React, { useEffect } from "react";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";

/** عرض فاتورة المشتريات للقراءة فقط + طباعة/تحميل PDF — يستخدم PrintShell المشترك فيرث هيدر/فوتر الشركة تلقائياً */
export default function PurchaseInvoiceViewModal({ invoice, companies, autoPrint, onClose }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(t);
  }, [autoPrint, invoice.id]);

  const company = companies?.find((c) => c.id === invoice.companyId) || invoice.company;
  const supplier = invoice.supplier;

  return (
    <PrintShell
      subtitle="فاتورة مشتريات"
      company={company}
      refNode={
        <>
          <div>رقم الفاتورة: <strong>{invoice.invoiceNumber}</strong></div>
          <div>التاريخ: <strong>{invoice.date.slice(0, 10)}</strong></div>
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>المشتري</span><strong>{company?.name}</strong></div>
        <div><span>الرقم الضريبي للمشتري</span><strong>{company?.vatNumber || "لم يُدخل بعد"}</strong></div>
        <div><span>المورد</span><strong>{supplier?.name}</strong></div>
        <div><span>الرقم الضريبي للمورد</span><strong>{supplier?.vatNumber || "غير مسجّل"}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>خصم %</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr>
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
            <td className="foot-label" colSpan={4}>الإجمالي</td>
            <td className="num strong">{fmt(Number(invoice.subtotal))}</td>
            <td className="num strong">{fmt(Number(invoice.vatTotal))}</td>
            <td className="num strong">{fmt(Number(invoice.grandTotal))}</td>
          </tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
