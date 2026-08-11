import React, { useEffect, useState } from "react";
import ReceiptView from "../../shared/receipt/ReceiptView";
import { loadPrinterSettings } from "../../shared/receipt/posLocalSettings";
import { buildReceiptEscPos, requestBluetoothPrinter, sendToBluetoothPrinter } from "../../shared/receipt/escpos";

export default function ReceiptScreen({ company, sale, onNewSale }) {
  const { invoice, payments, receivedCash, change } = sale;
  const settings = loadPrinterSettings();
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");

  const paymentsForView = Object.assign([...payments], { receivedCash, change });

  const printViaBrowser = () => window.print();

  const printViaBluetooth = async () => {
    setPrinting(true);
    setPrintError("");
    try {
      const device = await requestBluetoothPrinter();
      const bytes = buildReceiptEscPos({ company, invoice }, settings.paperWidthMm);
      await sendToBluetoothPrinter(device, bytes);
    } catch (err) {
      setPrintError(err.message || "تعذّرت الطباعة عبر البلوتوث");
    } finally {
      setPrinting(false);
    }
  };

  const doPrint = () => (settings.method === "bluetooth" ? printViaBluetooth() : printViaBrowser());

  useEffect(() => {
    if (settings.autoPrint) doPrint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pos-receipt-screen">
      <div className="pos-receipt-success">
        <span className="pos-receipt-check">✓</span>
        <div>تمت عملية البيع بنجاح</div>
        <div className="pos-receipt-invoice-number">فاتورة رقم {invoice.invoiceNumber}</div>
      </div>

      <div className="pos-receipt-preview">
        <ReceiptView company={company} invoice={invoice} paperWidthMm={settings.paperWidthMm} lastPayments={paymentsForView} />
      </div>

      {printError && <p className="m-error">{printError}</p>}

      <div className="pos-receipt-actions">
        <button className="m-btn secondary" disabled={printing} onClick={doPrint}>
          {printing ? "جارٍ الطباعة..." : "🖨 إعادة طباعة"}
        </button>
        <button className="pos-big-btn" onClick={onNewSale}>بيع جديد</button>
      </div>
    </div>
  );
}
