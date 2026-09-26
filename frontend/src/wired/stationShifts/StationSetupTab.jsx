import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createCostCenter } from "../../api/costCenters";
import * as api from "../../api/stationSetup";

/**
 * إعداد المحطات: المحطات، ومضخات كل محطة، وفوهتا كل مضخة. المضخة فوهتان بالضبط — بنزين (91 + 95) أو
 * ديزل (ديزل + ديزل) — ونوع وقود كل فوهة يتحدد بنوع المضخة لا باختيار حر. لكل فوهة إعدادان إلزاميان بلا
 * قيمة افتراضية: عدد خانات العداد (يحدد نقطة "اللفّة" في حساب اللترات المباعة) وقراءة العداد الحالية
 * (قراءة افتتاح أول وردية). الخادم يعيد التحقق من كل ذلك؛ هذه الشاشة لا تتجاوزه.
 */
const PRODUCTS_BY_PUMP = { petrol: ["gasoline_91", "gasoline_95"], diesel: ["diesel", "diesel"] };
const emptyPump = () => ({ pumpType: "petrol", meterType: "mechanical", nozzles: [{ meterDigits: "", initialReading: "" }, { meterDigits: "", initialReading: "" }] });

export default function StationSetupTab({ companyId }) {
  const { t } = useTranslation();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newStationName, setNewStationName] = useState("");
  const [openFormFor, setOpenFormFor] = useState(null);
  const [pumpForm, setPumpForm] = useState(emptyPump());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError("");
    try {
      setStations(await api.listStations(companyId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setLoading(true); load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, okMessage) => {
    setError(""); setMessage(""); setSaving(true);
    try {
      await fn();
      if (okMessage) setMessage(okMessage);
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addStation = () => {
    if (newStationName.trim().length < 2) { setError(t("stationWorkers.errStationName")); return; }
    run(async () => { await createCostCenter({ name: newStationName.trim(), companyId }); setNewStationName(""); });
  };

  const setNozzle = (i, field, value) =>
    setPumpForm((f) => ({ ...f, nozzles: f.nozzles.map((n, j) => (j === i ? { ...n, [field]: value } : n)) }));

  const addPump = async (stationId) => {
    for (const n of pumpForm.nozzles) {
      if (!/^\d+$/.test(String(n.meterDigits)) || n.initialReading === "" || Number(n.initialReading) < 0) {
        setError(t("stationSetup.errNozzleFields"));
        return;
      }
    }
    const ok = await run(
      () => api.createPump({
        companyId,
        costCenterId: stationId,
        pumpType: pumpForm.pumpType,
        meterType: pumpForm.meterType,
        nozzles: pumpForm.nozzles.map((n) => ({ meterDigits: Number(n.meterDigits), initialReading: Number(n.initialReading) })),
      }),
      t("stationSetup.pumpAdded"),
    );
    if (ok) { setOpenFormFor(null); setPumpForm(emptyPump()); }
  };

  const editDigits = (nozzle) => {
    const value = window.prompt(t("stationSetup.editDigitsPrompt"), String(nozzle.meterDigits));
    if (value == null || value === String(nozzle.meterDigits)) return;
    run(() => api.updateNozzle(nozzle.id, { meterDigits: Number(value) }), t("stationSetup.saved"));
  };

  const retire = (stationId, pumpNumber) => {
    if (!window.confirm(t("stationSetup.retireConfirm", { n: pumpNumber }))) return;
    run(() => api.retirePump({ companyId, costCenterId: stationId, pumpNumber }), t("stationSetup.saved"));
  };

  if (loading) return <div className="panel"><p className="note">…</p></div>;

  return (
    <div className="station-setup">
      {error && <p className="balance-bad" role="alert">{error}</p>}
      {message && <p className="note">{message}</p>}

      <div className="panel form-panel">
        <h3>{t("stationSetup.title")}</h3>
        <p className="note">{t("stationSetup.note")}</p>
        <div className="form-btn-group">
          <input type="text" value={newStationName} onChange={(e) => setNewStationName(e.target.value)} placeholder={t("stationWorkers.newStationPlaceholder")} />
          <button className="btn-ghost" onClick={addStation} disabled={saving}>{t("stationWorkers.addStation")}</button>
        </div>
      </div>

      {stations.length === 0 && <div className="panel"><p className="note">{t("stationWorkers.noStations")}</p></div>}

      {stations.map((station) => (
        <div className="panel station-card" key={station.id}>
          <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{station.name}</h3>
            <span className={`status-badge ${station.pumps.length === 0 ? "status-warn" : ""}`}>
              {station.pumps.length === 0 ? t("stationSetup.noPumpsBadge") : t("stationSetup.pumpCount", { count: station.pumps.length })}
            </span>
          </div>

          {station.pumps.length > 0 && (
            <div className="lines-table-wrap">
              <table className="lines-table station-pumps-table">
                <thead>
                  <tr>
                    <th>{t("stationSetup.pump")}</th><th>{t("stationSetup.nozzle")}</th><th>{t("stationSetup.product")}</th>
                    <th>{t("stationSetup.meterDigits")}</th><th>{t("stationSetup.initialReading")}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {station.pumps.flatMap((pump) =>
                    pump.nozzles.map((nozzle, i) => (
                      <tr key={nozzle.id}>
                        {i === 0 && (
                          <td rowSpan={pump.nozzles.length}>
                            <strong>{t("stationSetup.pumpN", { n: pump.pumpNumber })}</strong>
                            <div className="note">{t(`stationSetup.pumpType.${pump.pumpType}`)} · {t(`stationSetup.meterType.${pump.meterType}`)}</div>
                            <button className="btn-ghost btn-small" onClick={() => retire(station.id, pump.pumpNumber)}>{t("stationSetup.retire")}</button>
                          </td>
                        )}
                        <td>{nozzle.nozzleNumber}</td>
                        <td>{t(`stationSetup.products.${nozzle.product}`)}</td>
                        <td>
                          <span dir="ltr">{nozzle.meterDigits}</span>{" "}
                          <button className="btn-ghost btn-small" onClick={() => editDigits(nozzle)}>{t("stationSetup.edit")}</button>
                        </td>
                        <td dir="ltr">{Number(nozzle.initialReading).toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
                        <td className="note">{nozzle.hasReadings ? t("stationSetup.hasShifts") : ""}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}

          {openFormFor === station.id ? (
            <div className="station-pump-form">
              <h4 className="sub-head">{t("stationSetup.newPumpTitle")}</h4>
              <div className="form-grid">
                <label>{t("stationSetup.pumpTypeLabel")}
                  <select value={pumpForm.pumpType} onChange={(e) => setPumpForm({ ...pumpForm, pumpType: e.target.value })}>
                    <option value="petrol">{t("stationSetup.pumpType.petrol")}</option>
                    <option value="diesel">{t("stationSetup.pumpType.diesel")}</option>
                  </select>
                </label>
                <label>{t("stationSetup.meterTypeLabel")}
                  <select value={pumpForm.meterType} onChange={(e) => setPumpForm({ ...pumpForm, meterType: e.target.value })}>
                    <option value="mechanical">{t("stationSetup.meterType.mechanical")}</option>
                    <option value="electronic">{t("stationSetup.meterType.electronic")}</option>
                  </select>
                </label>
              </div>
              {pumpForm.nozzles.map((n, i) => (
                <div className="form-grid station-nozzle-row" key={i}>
                  <div className="station-nozzle-label">
                    {t("stationSetup.nozzleN", { n: i + 1 })}: <strong>{t(`stationSetup.products.${PRODUCTS_BY_PUMP[pumpForm.pumpType][i]}`)}</strong>
                  </div>
                  <label>{t("stationSetup.meterDigits")}
                    <input type="number" min="4" max="10" inputMode="numeric" value={n.meterDigits} onChange={(e) => setNozzle(i, "meterDigits", e.target.value)} placeholder={t("stationSetup.meterDigitsPlaceholder")} />
                  </label>
                  <label>{t("stationSetup.currentReading")}
                    <input type="number" min="0" step="0.001" inputMode="decimal" value={n.initialReading} onChange={(e) => setNozzle(i, "initialReading", e.target.value)} />
                  </label>
                </div>
              ))}
              <p className="note">{t("stationSetup.digitsHelp")}</p>
              <div className="form-btn-group">
                <button className="btn-ghost" onClick={() => { setOpenFormFor(null); setPumpForm(emptyPump()); }}>{t("common.cancel")}</button>
                <button className="btn-primary" onClick={() => addPump(station.id)} disabled={saving}>{t("stationSetup.savePump")}</button>
              </div>
            </div>
          ) : (
            <button className="btn-ghost" onClick={() => { setOpenFormFor(station.id); setPumpForm(emptyPump()); setError(""); }}>
              {t("stationSetup.addPump")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
