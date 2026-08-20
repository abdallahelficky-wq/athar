import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadPrinterSettings, savePrinterSettings } from "../../shared/receipt/posLocalSettings";
import { requestBluetoothPrinter } from "../../shared/receipt/escpos";
import { loadPosWarehouseId, savePosWarehouseId } from "../posWarehouseSettings";
import { listWarehouses } from "../../api/warehouses";

/** إعدادات هذا الجهاز فقط (بلا مزامنة مع الخادم) — كل تابلت/موبايل يضبط طابعته ومستودعه بشكل
 * مستقل عن بقية الأجهزة، حتى لو استخدموا نفس تسجيل الدخول. */
export default function PosSettingsScreen({ companyId, onClose }) {
  const { t } = useTranslation();
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
      .catch(() => setWarehouseError(t("pos.settings.warehouseLoadError")));
  }, [companyId, t]);

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
      update({ method: "bluetooth", bluetoothDeviceName: device.name || t("pos.settings.defaultBtName") });
    } catch (err) {
      setPairError(err.message || t("pos.settings.pairError"));
    } finally {
      setPairing(false);
    }
  };

  return (
    <div className="pos-settings-screen">
      <div className="pos-modal-header">
        <span>{t("pos.settings.title")}</span>
        <button className="pos-icon-btn" onClick={onClose}>✕</button>
      </div>

      <div className="m-card">
        <div className="pos-section-label">{t("pos.settings.warehouseSection")}</div>
        {warehouseError && <p className="m-error">{warehouseError}</p>}
        {warehouses === null && !warehouseError && <p className="m-empty">{t("common.loading")}</p>}
        {warehouses !== null && warehouses.length === 0 && (
          <p className="m-error">{t("pos.settings.noWarehouse")}</p>
        )}
        {warehouses !== null && warehouses.map((w) => (
          <label className="pos-radio-row" key={w.id}>
            <input type="radio" name="warehouse" checked={warehouseId === w.id} onChange={() => chooseWarehouse(w.id)} />
            {w.name}
          </label>
        ))}
      </div>

      <div className="m-card">
        <div className="pos-section-label">{t("pos.settings.printMethodSection")}</div>
        <label className="pos-radio-row">
          <input type="radio" name="method" checked={settings.method === "browser"} onChange={() => update({ method: "browser" })} />
          {t("pos.settings.methodBrowser")}
        </label>
        <label className="pos-radio-row">
          <input type="radio" name="method" checked={settings.method === "bluetooth"} onChange={() => update({ method: "bluetooth" })} />
          {t("pos.settings.methodBluetooth")}
        </label>

        {settings.method === "bluetooth" && (
          <div className="pos-bt-pair-box">
            <div>{settings.bluetoothDeviceName ? t("pos.settings.pairedPrinter", { name: settings.bluetoothDeviceName }) : t("pos.settings.noPrinterPaired")}</div>
            <button className="m-btn secondary" disabled={pairing} onClick={pairBluetooth}>
              {pairing ? t("pos.settings.searchingPrinter") : t("pos.settings.searchPrinterBtn")}
            </button>
            {pairError && <p className="m-error">{pairError}</p>}
          </div>
        )}
      </div>

      <div className="m-card">
        <div className="pos-section-label">{t("pos.settings.paperSizeSection")}</div>
        <label className="pos-radio-row">
          <input type="radio" name="width" checked={settings.paperWidthMm === 58} onChange={() => update({ paperWidthMm: 58 })} />
          {t("pos.settings.paper58")}
        </label>
        <label className="pos-radio-row">
          <input type="radio" name="width" checked={settings.paperWidthMm === 80} onChange={() => update({ paperWidthMm: 80 })} />
          {t("pos.settings.paper80")}
        </label>
      </div>

      <div className="m-card">
        <label className="pos-radio-row">
          <input type="checkbox" checked={settings.autoPrint} onChange={(e) => update({ autoPrint: e.target.checked })} />
          {t("pos.settings.autoPrintLabel")}
        </label>
      </div>

      <button className="pos-big-btn" onClick={onClose} disabled={warehouses !== null && warehouses.length > 0 && !warehouseId}>{t("pos.settings.doneBtn")}</button>
    </div>
  );
}
