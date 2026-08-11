import React from "react";
import { QrImage } from "../../legacy/shared";

/**
 * معاينة/طباعة إيصال بعرض 58 أو 80مم — تُستخدَم كمعاينة على الشاشة داخل نقطة البيع، وكذلك
 * كمصدر طباعة عادية عبر window.print() لأي جهاز (خصوصاً آيفون/آيباد حيث Web Bluetooth غير مدعوم).
 * تصميم عمود واحد بسيط بلا أي عناصر A4 (لا صناديق توقيع، لا رأس ثلاثي الأعمدة).
 */
export default function ReceiptView({ company, invoice, paperWidthMm = 80, lastPayments }) {
  const width = paperWidthMm === 58 ? "58mm" : "80mm";
  return (
    <div className="receipt-print-root">
      <style>{`
        @media print {
          @page { size: ${width} auto; margin: 2mm; }
          body * { visibility: hidden; }
          .receipt-print-root, .receipt-print-root * { visibility: visible; }
          .receipt-print-root { position: absolute; top: 0; right: 0; }
        }
        .receipt-print-root {
          width: ${width}; font-family: 'Tajawal', 'IBM Plex Sans Arabic', sans-serif;
          font-size: ${paperWidthMm === 58 ? "11px" : "12.5px"}; color: #000; direction: rtl;
          padding: 4mm 3mm;
        }
        .receipt-center { text-align: center; }
        .receipt-company-name { font-weight: 800; font-size: 1.35em; margin-bottom: 2px; }
        .receipt-divider { border-top: 1px dashed #000; margin: 6px 0; }
        .receipt-row { display: flex; justify-content: space-between; gap: 6px; }
        .receipt-line-name { font-weight: 700; }
        .receipt-line-detail { display: flex; justify-content: space-between; color: #333; }
        .receipt-total-row { display: flex; justify-content: space-between; font-weight: 800; font-size: 1.2em; margin-top: 4px; }
        .receipt-qr-box { display: flex; flex-direction: column; align-items: center; margin-top: 8px; }
        .receipt-footer { text-align: center; margin-top: 8px; font-size: 0.95em; }
      `}</style>

      <div className="receipt-center">
        <div className="receipt-company-name">{company?.name}</div>
        {company?.vatNumber && <div>الرقم الضريبي: {company.vatNumber}</div>}
      </div>
      <div className="receipt-divider" />

      <div>رقم الفاتورة: <strong>{invoice.invoiceNumber}</strong></div>
      <div>{new Date(invoice.date).toLocaleString("ar-SA")}</div>
      <div>العميل: {invoice.customer?.name || "عميل نقدي"}</div>
      <div className="receipt-divider" />

      {(invoice.lines || []).map((line) => (
        <div key={line.id || `${line.description}-${line.quantity}`} style={{ marginBottom: 4 }}>
          <div className="receipt-line-name">{line.description || line.account?.name}</div>
          <div className="receipt-line-detail">
            <span>{Number(line.quantity)} × {Number(line.unitPrice).toFixed(2)}</span>
            <span>{Number(line.total).toFixed(2)}</span>
          </div>
        </div>
      ))}
      <div className="receipt-divider" />

      <div className="receipt-row"><span>قبل الضريبة</span><span>{Number(invoice.subtotal).toFixed(2)}</span></div>
      <div className="receipt-row"><span>الضريبة</span><span>{Number(invoice.vatTotal).toFixed(2)}</span></div>
      <div className="receipt-total-row"><span>الإجمالي</span><span>{Number(invoice.grandTotal).toFixed(2)}</span></div>

      {lastPayments && lastPayments.length > 0 && (
        <>
          <div className="receipt-divider" />
          {lastPayments.map((p, i) => (
            <div className="receipt-row" key={i}>
              <span>{p.method === "cash" ? "نقدي" : "بطاقة/بنك"}</span>
              <span>{Number(p.amount).toFixed(2)}</span>
            </div>
          ))}
          {lastPayments.receivedCash != null && (
            <>
              <div className="receipt-row"><span>المستلم نقداً</span><span>{Number(lastPayments.receivedCash).toFixed(2)}</span></div>
              <div className="receipt-row"><span>الباقي</span><span>{Number(lastPayments.change || 0).toFixed(2)}</span></div>
            </>
          )}
        </>
      )}

      {invoice.qrPayload && (
        <div className="receipt-qr-box">
          <QrImage payload={invoice.qrPayload} size={paperWidthMm === 58 ? 110 : 140} />
        </div>
      )}

      <div className="receipt-footer">شكراً لتعاملكم معنا</div>
    </div>
  );
}
