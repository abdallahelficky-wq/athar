import React from "react";
import { useTranslation } from "react-i18next";
import { QrImage } from "../../legacy/shared";
import { formatDateTime } from "../../i18n/dateFormat";

/**
 * معاينة/طباعة إيصال بعرض 58 أو 80مم — تُستخدَم كمعاينة على الشاشة داخل نقطة البيع، وكذلك
 * كمصدر طباعة عادية عبر window.print() لأي جهاز (خصوصاً آيفون/آيباد حيث Web Bluetooth غير مدعوم).
 * تصميم عمود واحد بسيط بلا أي عناصر A4 (لا صناديق توقيع، لا رأس ثلاثي الأعمدة).
 */
export default function ReceiptView({ company, invoice, paperWidthMm = 80, lastPayments }) {
  const { t, i18n } = useTranslation();
  const width = paperWidthMm === 58 ? "58mm" : "80mm";
  const dir = i18n.language === "en" ? "ltr" : "rtl";
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
          font-size: ${paperWidthMm === 58 ? "11px" : "12.5px"}; color: #000; direction: ${dir};
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
        {company?.vatNumber && <div>{t("receiptView.vatNumberLabel")}: {company.vatNumber}</div>}
      </div>
      <div className="receipt-divider" />

      <div>{t("receiptView.invoiceNumberLabel")}: <strong>{invoice.invoiceNumber}</strong></div>
      <div>{formatDateTime(invoice.date, i18n.language)}</div>
      <div>{t("receiptView.customerLabel")}: {invoice.customer?.name || t("receiptView.cashCustomer")}</div>
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

      <div className="receipt-row"><span>{t("receiptView.beforeVat")}</span><span>{Number(invoice.subtotal).toFixed(2)}</span></div>
      <div className="receipt-row"><span>{t("receiptView.vat")}</span><span>{Number(invoice.vatTotal).toFixed(2)}</span></div>
      <div className="receipt-total-row"><span>{t("receiptView.total")}</span><span>{Number(invoice.grandTotal).toFixed(2)}</span></div>

      {lastPayments && lastPayments.length > 0 && (
        <>
          <div className="receipt-divider" />
          {lastPayments.map((p, i) => (
            <div className="receipt-row" key={i}>
              <span>{p.method === "cash" ? t("receiptView.methodCash") : t("receiptView.methodBank")}</span>
              <span>{Number(p.amount).toFixed(2)}</span>
            </div>
          ))}
          {lastPayments.receivedCash != null && (
            <>
              <div className="receipt-row"><span>{t("receiptView.receivedCash")}</span><span>{Number(lastPayments.receivedCash).toFixed(2)}</span></div>
              <div className="receipt-row"><span>{t("receiptView.change")}</span><span>{Number(lastPayments.change || 0).toFixed(2)}</span></div>
            </>
          )}
        </>
      )}

      {invoice.qrPayload && (
        <div className="receipt-qr-box">
          <QrImage payload={invoice.qrPayload} size={paperWidthMm === 58 ? 110 : 140} />
        </div>
      )}

      <div className="receipt-footer">{t("receiptView.thankYou")}</div>
    </div>
  );
}
