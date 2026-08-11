import React, { useEffect, useState } from "react";
import { loadPrinterSettings, savePrinterSettings } from "../../shared/receipt/posLocalSettings";
import { requestBluetoothPrinter } from "../../shared/receipt/escpos";
import { loadPosWarehouseId, savePosWarehouseId } from "../posWarehouseSettings";
import { listWarehouses } from "../../api/warehouses";

/** إعدادات هذا الجهاز فقط (بلا مزامنة مع الخادم) — كل تابلت/موبايل يضبط طابعته ومستودعه بشكل
 * مستقل عن بقية الأجهزة، حتى لو استخدموا نفس تسجيل الدخول. */
export default function PosSettingsScreen({ companyId, onClose }) {
  const [settings, setSettings] = useState(loadPrinterSettings());
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState("");

  const [warehouses, setWarehouses] = useState(null); // null = جارٍ التحميل
  const [warehouseId, setWarehouseId] = useState(() => loadPosWarehouseId(companyId));
  const [warehouseError, setWarehouseError] = useState("");

  useEffect(() => {
    setWarehouseError("");
    listWarehouses(companyId)
      .then((list) => {
        const active = list.filter((w) => !w.isArchived);
        setWarehouses(active);
        // لو للشركة مستودع واحد بس، يُختار تلقائياً بلا أي تدخّل من المستخدم — حتى لو الجهاز
        // لم يزر شاشة الإعدادات هذه من قبل إطلاقاً.
        if (active.length === 1 && !loadPosWarehouseId(companyId)) {
          savePosWarehouseId(companyId, active[0].id);
          setWarehouseId(active[0].id);
        }
      })
      .catch(() => setWarehouseError("تعذّر تحميل قائمة المستودعات"));
  }, [companyId]);

  const chooseWarehouse = (id) => {
    savePosWarehouseId(companyId, id);
    setWarehouseId(id);
  };

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
        <span>إعدادات نقطة البيع</span>
        <button className="pos-icon-btn" onClick={onClose}>✕</button>
      </div>

      <div className="m-card">
        <div className="pos-section-label">المستودع المرتبط بهذا الجهاز</div>
        {warehouseError && <p className="m-error">{warehouseError}</p>}
        {warehouses === null && !warehouseError && <p className="m-empty">جارٍ التحميل...</p>}
        {warehouses !== null && warehouses.length === 0 && (
          <p className="m-error">لا يوجد أي مستودع لهذه الشركة بعد — أنشئ مستودعاً أولاً من شاشة المستودعات والمنتجات</p>
        )}
        {warehouses !== null && warehouses.map((w) => (
          <label className="pos-radio-row" key={w.id}>
            <input type="radio" name="warehouse" checked={warehouseId === w.id} onChange={() => chooseWarehouse(w.id)} />
            {w.name}
          </label>
        ))}
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

      <button className="pos-big-btn" onClick={onClose} disabled={warehouses !== null && warehouses.length > 0 && !warehouseId}>تم</button>
    </div>
  );
}
