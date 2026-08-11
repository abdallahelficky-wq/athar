import React, { useState } from "react";
import { loadPrinterSettings, savePrinterSettings } from "../../shared/receipt/posLocalSettings";
import { requestBluetoothPrinter } from "../../shared/receipt/escpos";

/** إعدادات هذا الجهاز فقط (بلا مزامنة مع الخادم) — كل تابلت/موبايل يضبط طابعته بشكل مستقل. */
export default function PrinterSettingsScreen({ onClose }) {
  const [settings, setSettings] = useState(loadPrinterSettings());
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState("");

  const update = (patch) => setSettings(savePrinterSettings(patch));

  const pairBluetooth = async () => {
    setPairing(true);
    setPairError("");
    try {
      const device = await requestBluetoothPrinter();
      update({ method: "bluetooth", bluetoothDeviceName: device.name || "طابعة بلوتوث" });
    } catch (err) {
      setPairError(err.message || "تعذّر إقران الطابعة");
    } finally {
      setPairing(false);
    }
  };

  return (
    <div className="pos-settings-screen">
      <div className="pos-modal-header">
        <span>إعدادات الطابعة</span>
        <button className="pos-icon-btn" onClick={onClose}>✕</button>
      </div>

      <div className="m-card">
        <div className="pos-section-label">طريقة الطباعة</div>
        <label className="pos-radio-row">
          <input type="radio" name="method" checked={settings.method === "browser"} onChange={() => update({ method: "browser" })} />
          نافذة الطباعة العادية (تعمل على أي جهاز — بلا قصّ تلقائي)
        </label>
        <label className="pos-radio-row">
          <input type="radio" name="method" checked={settings.method === "bluetooth"} onChange={() => update({ method: "bluetooth" })} />
          طابعة بلوتوث حرارية (أندرويد/تابلت فقط)
        </label>

        {settings.method === "bluetooth" && (
          <div className="pos-bt-pair-box">
            <div>{settings.bluetoothDeviceName ? `الطابعة المقترنة: ${settings.bluetoothDeviceName}` : "لم تُقرَن أي طابعة بعد"}</div>
            <button className="m-btn secondary" disabled={pairing} onClick={pairBluetooth}>
              {pairing ? "جارٍ البحث..." : "🔍 البحث عن طابعة بلوتوث"}
            </button>
            {pairError && <p className="m-error">{pairError}</p>}
          </div>
        )}
      </div>

      <div className="m-card">
        <div className="pos-section-label">مقاس الورق</div>
        <label className="pos-radio-row">
          <input type="radio" name="width" checked={settings.paperWidthMm === 58} onChange={() => update({ paperWidthMm: 58 })} />
          58 مم
        </label>
        <label className="pos-radio-row">
          <input type="radio" name="width" checked={settings.paperWidthMm === 80} onChange={() => update({ paperWidthMm: 80 })} />
          80 مم
        </label>
      </div>

      <div className="m-card">
        <label className="pos-radio-row">
          <input type="checkbox" checked={settings.autoPrint} onChange={(e) => update({ autoPrint: e.target.checked })} />
          طباعة تلقائية بعد كل عملية بيع
        </label>
      </div>

      <button className="pos-big-btn" onClick={onClose}>تم</button>
    </div>
  );
}
