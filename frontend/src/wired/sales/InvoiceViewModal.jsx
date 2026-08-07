import React, { useEffect } from "react";
import { PrintShell, QrImage, printWithOrientation } from "../../legacy/shared";
import { fmt, fmt2 } from "../../legacy/constants";

/**
 * عرض الفاتورة للقراءة فقط (بدون أي حقول قابلة للتعديل) + إمكانية الطباعة/تحميل PDF —
 * تُستخدَم من أيقونتي "عرض" و"طباعة" في قائمة الفواتير، وكذلك من زر "طباعة" داخل نافذة التعديل.
 */
export default function InvoiceViewModal({ invoice, companies, autoPrint, onClose }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(t);
  }, [autoPrint, invoice.id]);

  // نُفضّل بيانات الشركة الحالية (شعار/عنوان/رقم ضريبي محدَّث) من القائمة الحقيقية المحمَّلة
  // على مستوى التطبيق بدل النسخة المضمَّنة في الفاتورة (والتي لا تحمل logoUrl صالحاً أصلاً)
  const company = companies?.find((c) => c.id === invoice.companyId) || invoice.company;
  const customer = invoice.customer;
  const lastEmailLog = invoice.emailLogs?.[0];

  return (
    <PrintShell
      subtitle={invoice.invoiceType === "standard" ? "فاتورة ضريبية قياسية" : "فاتورة ضريبية مبسّطة"}
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
        <div><span>البائع</span><strong>{company?.name}</strong></div>
        <div><span>الرقم الضريبي للبائع</span><strong>{company?.vatNumber || "لم يُدخل بعد"}</strong></div>
        <div><span>العميل</span><strong>{customer?.name}</strong></div>
        <div><span>الرقم الضريبي للعميل</span><strong>{customer?.vatNumber || "غير مسجّل (فرد)"}</strong></div>
        {lastEmailLog && (
          <div>
            <span>آخر إرسال بالإيميل</span>
            <strong>
              {new Date(lastEmailLog.createdAt).toLocaleString("ar-SA")} — إلى {lastEmailLog.sentTo}
              {!lastEmailLog.success && " (فشل الإرسال)"}
            </strong>
          </div>
        )}
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
      <div className="qr-box">
        <div className="qr-box-label">رمز الاستجابة السريعة (QR) — وفق معيار زاتكا</div>
        <QrImage payload={invoice.qrPayload} />
        <details className="qr-details">
          <summary>عرض حمولة البيانات المشفّرة (Base64 TLV)</summary>
          <div className="qr-box-payload">{invoice.qrPayload}</div>
        </details>
      </div>
    </PrintShell>
  );
}
