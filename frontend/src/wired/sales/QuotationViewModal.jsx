import React, { useEffect } from "react";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";

/**
 * عرض عرض السعر للقراءة فقط + إمكانية الطباعة/تحميل PDF عبر PrintShell المشترك (نفس
 * الهيدر/الفوتر الموحّد المستخدَم في فواتير المبيعات) — تُستخدَم من أيقونتي "عرض" و"طباعة"
 * في قائمة عروض الأسعار، وكذلك من زر "طباعة" داخل نافذة التعديل.
 */
export default function QuotationViewModal({ quotation, companies, autoPrint, onClose }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(t);
  }, [autoPrint, quotation.id]);

  const company = companies?.find((c) => c.id === quotation.companyId) || quotation.company;
  const customer = quotation.customer;

  return (
    <PrintShell
      subtitle="عرض سعر"
      company={company}
      refNode={
        <>
          <div>رقم العرض: <strong>{quotation.quoteNumber}</strong></div>
          <div>التاريخ: <strong>{quotation.date.slice(0, 10)}</strong></div>
          {quotation.validUntil && <div>صالح حتى: <strong>{quotation.validUntil.slice(0, 10)}</strong></div>}
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>مقدّم العرض</span><strong>{company?.name}</strong></div>
        <div><span>الرقم الضريبي</span><strong>{company?.vatNumber || "لم يُدخل بعد"}</strong></div>
        <div><span>العميل</span><strong>{customer?.name}</strong></div>
        <div><span>الرقم الضريبي للعميل</span><strong>{customer?.vatNumber || "غير مسجّل (فرد)"}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>خصم %</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr>
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
            <td className="foot-label" colSpan={4}>الإجمالي</td>
            <td className="num strong">{fmt(Number(quotation.subtotal))}</td>
            <td className="num strong">{fmt(Number(quotation.vatTotal))}</td>
            <td className="num strong">{fmt(Number(quotation.grandTotal))}</td>
          </tr>
        </tfoot>
      </table>
      {quotation.status === "converted" && (
        <p className="note">تم تحويل عرض السعر هذا إلى فاتورة مبيعات بالفعل.</p>
      )}
    </PrintShell>
  );
}
