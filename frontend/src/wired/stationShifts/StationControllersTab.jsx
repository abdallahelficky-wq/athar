import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/forecourt";
import { listStations } from "../../api/stationSetup";
import { formatDateTime } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";

/**
 * متحكمات المحطات (PTS-2): تسجيل متحكم لكل محطة بمعرّف لوحته، حالته (متصل/صامت)، وربط أرقام المضخات والفوهات فيه بفوهات
 * أثر. أرقام الخزانات تُضبط في "الخزانات والتوريد" (رقمه في جهاز القياس الآلي). استقبال البيانات نفسه يُفعَّل بعد وصول
 * مواصفة بروتوكول المتحكم من المصنّع.
 */
const HEALTH_COLOR = { online: "#2F5D5A", silent: "#A8432B", never_seen: "#6B7280", inactive: "#6B7280" };

export default function StationControllersTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [controllers, setControllers] = useState([]);
  const [stations, setStations] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({});
  const [mapDraft, setMapDraft] = useState({});

  const load = () => Promise.all([api.listControllers(companyId), listStations(companyId), api.listTransactions(companyId)])
    .then(([c, s, tx]) => { setControllers(c); setStations(s); setTransactions(tx); })
    .catch((e) => setError(e.message));
  useEffect(() => { if (companyId) load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    setError(""); setMessage("");
    try { await fn(); setDialog(false); setMessage(t("stationControllers.saved")); await load(); }
    catch (e) { setError(e.message); }
  };

  const freeStations = stations.filter((s) => !controllers.some((c) => c.costCenterId === s.id));
  const save = () => run(() => (form.id
    ? api.updateController(form.id, { name: form.name || undefined, firmwareVersion: form.firmwareVersion || undefined, silentAfterMinutes: Number(form.silentAfterMinutes) || undefined })
    : api.createController({ companyId, costCenterId: form.costCenterId, deviceSerial: form.deviceSerial, name: form.name || undefined, firmwareVersion: form.firmwareVersion || undefined, silentAfterMinutes: Number(form.silentAfterMinutes) || undefined })));

  const mapFor = (c, nozzleId) => c.nozzleMaps.find((m) => m.nozzleId === nozzleId);
  const draftKey = (c, n) => `${c.id}:${n.id}`;
  const saveMap = (c, n) => {
    const draft = mapDraft[draftKey(c, n)] || {};
    const current = mapFor(c, n.id);
    const ptsPump = Number(draft.ptsPump ?? current?.ptsPump);
    const ptsNozzle = Number(draft.ptsNozzle ?? current?.ptsNozzle);
    if (!ptsPump || !ptsNozzle) { setError(t("stationControllers.mapMissing")); return; }
    return run(async () => {
      if (current && (current.ptsPump !== ptsPump || current.ptsNozzle !== ptsNozzle)) await api.setNozzleMap(c.id, { ptsPump: current.ptsPump, ptsNozzle: current.ptsNozzle, nozzleId: null });
      await api.setNozzleMap(c.id, { ptsPump, ptsNozzle, nozzleId: n.id });
    });
  };
  const clearMap = (c, n) => { const m = mapFor(c, n.id); if (m) run(() => api.setNozzleMap(c.id, { ptsPump: m.ptsPump, ptsNozzle: m.ptsNozzle, nozzleId: null })); };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <p className="note">{t("stationControllers.intro")}</p>
      {error && !dialog && <p className="balance-bad">{error}</p>}
      {message && <p className="note">{message}</p>}

      <div className="panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{t("stationControllers.title")}</h3>
          <button className="btn-primary" disabled={!freeStations.length} onClick={() => { setError(""); setForm({ costCenterId: freeStations[0]?.id || "", deviceSerial: "", name: "", firmwareVersion: "", silentAfterMinutes: 10 }); setDialog(true); }}>+ {t("stationControllers.add")}</button>
        </div>
        <table className="ledger-table">
          <thead><tr><th>{t("stationTanks.station")}</th><th>{t("stationControllers.serial")}</th><th>{t("stationControllers.name")}</th><th>{t("stationControllers.health")}</th><th>{t("stationControllers.lastSeen")}</th><th></th></tr></thead>
          <tbody>
            {controllers.map((c) => (
              <tr key={c.id}>
                <td>{c.costCenter?.name}</td><td style={{ fontFamily: "monospace" }}>{c.deviceSerial}</td><td>{c.name || "—"}</td>
                <td><strong style={{ color: HEALTH_COLOR[c.health] }}>{t(`stationControllers.healths.${c.health}`, { minutes: c.silentAfterMinutes })}</strong></td>
                <td>{c.lastSeenAt ? formatDateTime(c.lastSeenAt, i18n.language) : "—"}</td>
                <td className="row-actions">
                  <button className="btn-ghost" onClick={() => { setError(""); setForm({ id: c.id, costCenterId: c.costCenterId, deviceSerial: c.deviceSerial, name: c.name || "", firmwareVersion: c.firmwareVersion || "", silentAfterMinutes: c.silentAfterMinutes }); setDialog(true); }}>{t("stationTanks.edit")}</button>
                  <button className="btn-ghost" onClick={() => run(() => api.updateController(c.id, { isActive: !c.isActive }))}>{c.isActive ? t("stationTanks.deactivate") : t("stationTanks.activate")}</button>
                </td>
              </tr>
            ))}
            {controllers.length === 0 && <tr><td className="empty" colSpan={6}>{t("stationControllers.empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {controllers.map((c) => {
        const station = stations.find((s) => s.id === c.costCenterId);
        const nozzles = (station?.pumps || []).flatMap((p) => p.nozzles.map((n) => ({ ...n, pumpNumber: p.pumpNumber })));
        return (
          <div className="panel" key={`map-${c.id}`}>
            <h3 style={{ marginTop: 0 }}>{t("stationControllers.mapTitle", { station: c.costCenter?.name })}</h3>
            <p className="note">{t("stationControllers.mapNote")}</p>
            <table className="ledger-table">
              <thead><tr><th>{t("stationSetup.pump")}</th><th>{t("stationSetup.nozzle")}</th><th>{t("stationTanks.product")}</th><th>{t("stationControllers.ptsPump")}</th><th>{t("stationControllers.ptsNozzle")}</th><th></th></tr></thead>
              <tbody>
                {nozzles.map((n) => {
                  const m = mapFor(c, n.id);
                  const draft = mapDraft[draftKey(c, n)] || {};
                  const setDraft = (k, v) => setMapDraft({ ...mapDraft, [draftKey(c, n)]: { ...draft, [k]: v } });
                  return (
                    <tr key={n.id}>
                      <td>{t("stationSetup.pumpN", { n: n.pumpNumber })}</td><td>{n.nozzleNumber}</td><td>{t(`stationSetup.products.${n.product}`)}</td>
                      <td><input type="number" min="1" style={{ width: 80 }} value={draft.ptsPump ?? m?.ptsPump ?? ""} onChange={(e) => setDraft("ptsPump", e.target.value)} /></td>
                      <td><input type="number" min="1" style={{ width: 80 }} value={draft.ptsNozzle ?? m?.ptsNozzle ?? ""} onChange={(e) => setDraft("ptsNozzle", e.target.value)} /></td>
                      <td className="row-actions">
                        <button className="btn-ghost" onClick={() => saveMap(c, n)}>{t("stationTanks.save")}</button>
                        {m && <button className="btn-ghost" onClick={() => clearMap(c, n)}>{t("stationControllers.unlink")}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t("stationControllers.txTitle")}</h3>
        <table className="ledger-table">
          <thead><tr><th>{t("stationControllers.endedAt")}</th><th>{t("stationControllers.ptsPump")}</th><th>{t("stationControllers.ptsNozzle")}</th><th>{t("stationControllers.txNumber")}</th><th>{t("stationTanks.liters")}</th><th>{t("stationControllers.totalVolume")}</th><th>{t("stationControllers.mapped")}</th></tr></thead>
          <tbody>
            {transactions.slice(0, 100).map((x) => (
              <tr key={x.id}>
                <td>{formatDateTime(x.endedAt, i18n.language)}</td><td>{x.ptsPump}</td><td>{x.ptsNozzle}</td><td>{x.transactionNumber}</td>
                <td className="num">{fmt2(x.volume)}</td><td className="num">{x.totalVolume == null ? "—" : fmt2(x.totalVolume)}</td><td>{x.nozzleId ? "✓" : t("stationControllers.unmapped")}</td>
              </tr>
            ))}
            {transactions.length === 0 && <tr><td className="empty" colSpan={7}>{t("stationControllers.noTx")}</td></tr>}
          </tbody>
        </table>
      </div>

      <FormDialog open={dialog} title={form.id ? t("stationControllers.edit") : t("stationControllers.add")} onClose={() => setDialog(false)}>
        <div className="form-grid">
          <label>{t("stationTanks.station")}<select disabled={!!form.id} value={form.costCenterId || ""} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>{(form.id ? stations : freeStations).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>{t("stationControllers.serial")}<input disabled={!!form.id} value={form.deviceSerial || ""} placeholder="003B00265030500420303531" onChange={(e) => setForm({ ...form, deviceSerial: e.target.value })} style={{ fontFamily: "monospace" }} /></label>
          <label>{t("stationControllers.name")}<input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("stationControllers.firmware")}<input value={form.firmwareVersion || ""} onChange={(e) => setForm({ ...form, firmwareVersion: e.target.value })} /></label>
          <label>{t("stationControllers.silentAfter")}<input type="number" min="1" value={form.silentAfterMinutes ?? 10} onChange={(e) => setForm({ ...form, silentAfterMinutes: e.target.value })} /></label>
        </div>
        <p className="note">{t("stationControllers.serialNote")}</p>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={() => setDialog(false)}>{t("stationShiftsReview.cancelBtn")}</button><button className="btn-primary" disabled={!form.costCenterId || !form.deviceSerial} onClick={save}>{t("stationTanks.save")}</button></div>
      </FormDialog>
    </div>
  );
}
