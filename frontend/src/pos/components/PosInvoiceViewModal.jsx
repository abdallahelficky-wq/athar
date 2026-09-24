import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSalesInvoice, getSalesInvoicePdfBlob, sendInvoiceEmail } from "../../api/salesInvoices";
import { downloadBlob } from "../../legacy/shared";
import { fmt2 } from "../../legacy/constants";
import { formatDateTime } from "../../i18n/dateFormat";
import {
  buildReceiptEscPos, buildReceiptEscPosChunks, requestBluetoothPrinter, sendToBluetoothPrinter, hasNativePrinterBridge, printViaNativeBridge,
} from "../../shared/receipt/escpos";
import { loadPrinterSettings } from "../../shared/receipt/posLocalSettings";
import { invoiceZatcaState } from "../../wired/sales/invoiceZatcaState";
import PosSendInvoiceEmailModal from "./PosSendInvoiceEmailModal";

/**
 * عرض فاتورة سابقة من قائمة نقطة البيع — يجلب النسخة الكاملة (سطور + QR + حالة زاتكا) عبر
 * getSalesInvoice نفسها المستخدَمة في شاشة الفواتير الرئيسية، بلا أي منطق خادم جديد. ثلاثة إجراءات
 * فقط كما طُلِب: طباعة (نفس آلية إيصال الدفع تماماً — buildReceiptEscPos عبر بلوتوث أو
 * window.print، راجع ReceiptScreen.jsx)، تحميل PDF (getSalesInvoicePdfBlob، نفس نسخة PDF المُرسَلة
 * بالإيميل فعلياً)، وإرسال بالإيميل (sendInvoiceEmail — يُطلَب عنوان صريح من العميل فقط لو لم يكن
 * لديه بريد مسجَّل، مع تعبئة تلقائية لو كان موجوداً بالفعل — راجع PosSendInvoiceEmailModal).
 */
export default function PosInvoiceViewModal({ invoiceId, onClose }) {
  const { t, i18n } = useTranslation();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setLoading(true);
    getSalesInvoice(invoiceId)
      .then(setInvoice)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  const printReceipt = async () => {
    setPrinting(true);
    setError("");
    try {
      if (hasNativePrinterBridge()) {
        const chunks = buildReceiptEscPosChunks({ company: invoice.company, invoice }, loadPrinterSettings().paperWidthMm);
        printViaNativeBridge(chunks);
        return;
      }
      const settings = loadPrinterSettings();
      if (settings.method === "bluetooth") {
        const device = await requestBluetoothPrinter();
        const bytes = buildReceiptEscPos({ company: invoice.company, invoice }, settings.paperWidthMm);
        await sendToBluetoothPrinter(device, bytes);
      } else {
        window.print();
      }
    } catch (err) {
      setError(err.message || t("pos.receipt.bluetoothPrintError"));
    } finally {
      setPrinting(false);
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    setError("");
    try {
      const { blob, filename } = await getSalesInvoicePdfBlob(invoiceId);
      downloadBlob(blob, filename || `invoice-${invoice.invoiceNumber}.pdf`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const sendEmail = async () => {
    if (!invoice.customer?.email) { setEmailModalOpen(true); return; }
    setSendingEmail(true);
    setError("");
    try {
      const result = await sendInvoiceEmail(invoiceId);
      setNotice(
        result.sent
          ? t("pos.invoiceView.emailSent", { email: invoice.customer.email })
          : t("pos.invoiceView.emailFailed"),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div className="pos-modal-box pos-invoice-view-box" onClick={(e) => e.stopPropagation()}>
        <div className="pos-modal-header">
          <span>{invoice ? invoice.invoiceNumber : t("pos.invoiceView.title")}</span>
          <button className="pos-icon-btn" onClick={onClose}>✕</button>
        </div>

        {loading && <p className="m-empty">{t("common.loading")}</p>}
        {error && <p className="m-error">{error}</p>}

        {invoice && (
          <>
            <div className="pos-invoice-view-meta">
              <span>{formatDateTime(invoice.date, i18n.language)}</span>
              <span>{invoice.customer?.name}</span>
              <span className={invoiceZatcaState(invoice).className}>
                {t(`salesInvoices.zatcaSummary.${invoiceZatcaState(invoice).key}`)}
              </span>
            </div>

            <div className="pos-invoice-view-lines">
              {invoice.lines.map((l) => (
                <div className="pos-invoice-view-line" key={l.id}>
                  <span>{l.description || l.account?.name}</span>
                  <span>{Number(l.quantity)} × {fmt2(Number(l.unitPrice))} = {fmt2(Number(l.total))}</span>
                </div>
              ))}
            </div>

            <div className="pos-invoice-view-totals">
              <div><span>{t("pos.invoiceView.subtotal")}</span><strong>{fmt2(Number(invoice.subtotal))}</strong></div>
              <div><span>{t("pos.invoiceView.vat")}</span><strong>{fmt2(Number(invoice.vatTotal))}</strong></div>
              <div className="pos-invoice-view-grand-total"><span>{t("pos.invoiceView.grandTotal")}</span><strong>{fmt2(Number(invoice.grandTotal))}</strong></div>
            </div>

            {invoice.qrPayload && (
              <details className="pos-invoice-view-qr">
                <summary>{t("pos.invoiceView.qrSummary")}</summary>
                <div className="pos-invoice-view-qr-payload">{invoice.qrPayload}</div>
              </details>
            )}

            {notice && <p className="pos-invoice-view-notice">{notice}</p>}

            <div className="pos-invoice-view-actions">
              <button className="m-btn" disabled={printing} onClick={printReceipt}>
                {printing ? t("pos.receipt.printing") : t("pos.invoiceView.printBtn")}
              </button>
              <button className="m-btn secondary" disabled={downloading} onClick={downloadPdf}>
                {downloading ? t("pos.invoiceView.downloading") : t("pos.invoiceView.downloadPdfBtn")}
              </button>
              <button className="m-btn secondary" disabled={sendingEmail} onClick={sendEmail}>
                {sendingEmail ? t("pos.invoiceView.sendingEmail") : t("pos.invoiceView.sendEmailBtn")}
              </button>
            </div>
          </>
        )}
      </div>

      {emailModalOpen && invoice && (
        <PosSendInvoiceEmailModal
          invoiceId={invoiceId}
          invoiceNumber={invoice.invoiceNumber}
          prefillEmail={invoice.customer?.email || ""}
          onClose={() => setEmailModalOpen(false)}
          onSent={(message) => { setEmailModalOpen(false); setNotice(message); }}
        />
      )}
    </div>
  );
}
