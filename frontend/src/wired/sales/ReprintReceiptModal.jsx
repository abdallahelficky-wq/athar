import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import ReceiptView from "../../shared/receipt/ReceiptView";
import { loadPrinterSettings } from "../../shared/receipt/posLocalSettings";
import { buildReceiptEscPos, requestBluetoothPrinter, sendToBluetoothPrinter } from "../../shared/receipt/escpos";

/** إعادة طباعة إيصال 58/80مم لفاتورة سابقة من شاشة فواتير المبيعات العادية — نفس مكوّن المعاينة
 * المستخدَم داخل نقطة البيع، بلا الحاجة لفتحها. */
export default function ReprintReceiptModal({ invoice, company, onClose }) {
  const { t } = useTranslation();
  const settings = loadPrinterSettings();
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");

  const printViaBluetooth = async () => {
    setPrinting(true);
    setError("");
    try {
      const device = await requestBluetoothPrinter();
      const bytes = buildReceiptEscPos({ company, invoice }, settings.paperWidthMm);
      await sendToBluetoothPrinter(device, bytes);
    } catch (err) {
      setError(err.message || t("sales.reprintReceiptModal.errBluetooth"));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay" onClick={(e) => e.target === e.currentTarget && !printing && onClose()}>
      <div className="unpost-confirm-box" style={{ maxWidth: 380 }}>
        <div className="modal-title-row">
          <h3>{t("sales.reprintReceiptModal.title", { number: invoice.invoiceNumber })}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={printing} aria-label={t("sales.reprintReceiptModal.close")}>×</button>
        </div>
        <div style={{ background: "#fff", borderRadius: 10, padding: 8, display: "flex", justifyContent: "center", maxHeight: "50vh", overflowY: "auto" }}>
          <ReceiptView company={company} invoice={invoice} paperWidthMm={settings.paperWidthMm} />
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={printing}>{t("sales.reprintReceiptModal.close")}</button>
          {settings.method === "bluetooth" && (
            <button className="btn-ghost" onClick={printViaBluetooth} disabled={printing}>
              {printing ? t("sales.reprintReceiptModal.printingBluetooth") : t("sales.reprintReceiptModal.printBluetooth")}
            </button>
          )}
          <button className="btn-primary" onClick={() => window.print()} disabled={printing}>{t("sales.reprintReceiptModal.printNormal")}</button>
        </div>
      </div>
    </div>
  );
}
