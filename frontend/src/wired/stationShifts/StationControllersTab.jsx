import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/forecourt";
import { listStations } from "../../api/stationSetup";
import { formatDateTime } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";
import { getOrgDisplayName } from "../shared/accountDisplayName";

/**
 * متحكمات المحطات (PTS-2): تسجيل متحكم لكل محطة بمعرّف لوحته، حالته (متصل/صامت)، وربط أرقام المضخات والفوهات فيه بفوهات
 * أثر. أرقام الخزانات تُضبط في "الخزانات والتوريد" (رقمه في جهاز القياس الآلي). مفتاح الربط يُولَّد هنا ويظهر مرة واحدة مع
 * الإعدادات التي تُكتب في صفحة "Remote server" بالجهاز، فيبدأ الجهاز برفع المبيعات والقياسات والتنبيهات إلى /api/pts/upload.
 */
const HEALTH_COLOR = { online: "#2F5D5A", silent: "#A8432B", never_seen: "#6B7280", inactive: "#6B7280" };

export default function StationControllersTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [controllers, setControllers] = useState([]);
  const [stations, setStations] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [secretView, setSecretView] = useState(null); // { controller, secretKey, settings }
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({});
  const [mapDraft, setMapDraft] = useState({});
  const [commands, setCommands] = useState([]);
  const [pumpDialog, setPumpDialog] = useState(null); // { controller, ptsPump, ptsNozzle, presetType, dose, price, result, busy }

  const load = () => Promise.all([api.listControllers(companyId), listStations(companyId), api.listTransactions(companyId), api.listAlerts(companyId).catch(() => []), api.connectionSettings().catch(() => null), api.listCommands(companyId).catch(() => [])])
    .then(([c, s, tx, al, st, cmd]) => { setControllers(c); setStations(s); setTransactions(tx); setAlerts(al); setSettings(st); setCommands(cmd); })
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
  /** مفتاح جديد يُبطل السابق فوراً — الجهاز يتوقف عن الرفع حتى يُكتب الجديد فيه، فيُطلَب تأكيد حين يوجد مفتاح. */
  const rotate = async (c) => {
    if (c.hasSecret && !window.confirm(t("stationControllers.rotateConfirm"))) return;
    setError(""); setMessage("");
    try { const res = await api.rotateSecret(c.id); setSecretView({ controller: c, ...res }); await load(); }
    catch (e) { setError(e.message); }
  };
  const copy = (text) => { try { navigator.clipboard?.writeText(text); setMessage(t("stationControllers.copied")); } catch { /* المتصفح يمنع النسخ — يُنسخ يدوياً */ } };

  /** يرسل أمر المضخة وينتظر رد الجهاز — النتيجة (نُفّذ/رُفض/لا رد/غير متصل) تظهر في النافذة نفسها وفي سجل الأوامر. */
  const sendCommand = async (kind) => {
    const d = pumpDialog;
    if (kind === "emergency" && !window.confirm(t("stationControllers.emergencyConfirm"))) return;
    setPumpDialog({ ...d, busy: true, result: null, error: "" });
    try {
      const res = kind === "authorize"
        ? await api.authorizePump(d.controller.id, {
          companyId, ptsPump: Number(d.ptsPump), ptsNozzle: d.ptsNozzle ? Number(d.ptsNozzle) : null, presetType: d.presetType,
          dose: d.presetType === "FullTank" ? null : Number(d.dose) || null, price: d.price ? Number(d.price) : null,
        })
        : await api.stopPump(d.controller.id, { companyId, ptsPump: kind === "emergency" ? 0 : Number(d.ptsPump), emergency: kind === "emergency" });
      setPumpDialog((cur) => cur && { ...cur, busy: false, result: res });
      load();
    } catch (e) {
      setPumpDialog((cur) => cur && { ...cur, busy: false, error: e.message });
    }
  };
  const resultText = (r) => t(`stationControllers.commandResult.${r.status}`, { reason: r.errorMessage || r.errorCode || "" });
  const RESULT_COLOR = { confirmed: "#2F5D5A", rejected: "#A8432B", timeout: "#A8432B", offline: "#A8432B", pending: "#6B7280" };
  const limitText = (x) => (x.type !== "pump_authorize" ? "—" : x.presetType === "FullTank" ? t("stationControllers.presets.FullTank") : `${fmt2(x.dose)} ${x.presetType === "Amount" ? t("stationControllers.presets.Amount") : t("stationControllers.presets.Volume")}`);

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
          <thead><tr><th>{t("stationTanks.station")}</th><th>{t("stationControllers.serial")}</th><th>{t("stationControllers.name")}</th><th>{t("stationControllers.health")}</th><th>{t("stationControllers.lastSeen")}</th><th>{t("stationControllers.secret")}</th><th></th></tr></thead>
          <tbody>
            {controllers.map((c) => (
              <tr key={c.id}>
                <td>{getOrgDisplayName(c.costCenter, i18n.language)}</td><td style={{ fontFamily: "monospace" }}>{c.deviceSerial}</td><td>{c.name || "—"}</td>
                <td>
                  <strong style={{ color: HEALTH_COLOR[c.health] }}>{t(`stationControllers.healths.${c.health}`, { minutes: c.silentAfterMinutes })}</strong>
                  <div className="note" style={{ color: c.online ? "#2F5D5A" : undefined }}>{c.online ? `● ${t("stationControllers.wsOnline")}` : t("stationControllers.wsOffline")}</div>
                </td>
                <td>{c.lastSeenAt ? formatDateTime(c.lastSeenAt, i18n.language) : "—"}{c.firmwareVersion && <div className="note">{t("stationControllers.firmware")}: {c.firmwareVersion}</div>}</td>
                <td>{c.hasSecret ? <span>✓ {c.secretKeySetAt ? formatDateTime(c.secretKeySetAt, i18n.language) : ""}</span> : <span className="note">{t("stationControllers.noSecret")}</span>}</td>
                <td className="row-actions">
                  <button className="btn-ghost" disabled={!c.isActive} onClick={() => setPumpDialog({ controller: c, ptsPump: c.nozzleMaps[0]?.ptsPump || 1, ptsNozzle: "", presetType: "Amount", dose: "", price: "", result: null, error: "", busy: false })}>{t("stationControllers.control")}</button>
                  <button className="btn-ghost" onClick={() => rotate(c)}>{c.hasSecret ? t("stationControllers.rotateSecret") : t("stationControllers.createSecret")}</button>
                  <button className="btn-ghost" onClick={() => { setError(""); setForm({ id: c.id, costCenterId: c.costCenterId, deviceSerial: c.deviceSerial, name: c.name || "", firmwareVersion: c.firmwareVersion || "", silentAfterMinutes: c.silentAfterMinutes }); setDialog(true); }}>{t("stationTanks.edit")}</button>
                  <button className="btn-ghost" onClick={() => run(() => api.updateController(c.id, { isActive: !c.isActive }))}>{c.isActive ? t("stationTanks.deactivate") : t("stationTanks.activate")}</button>
                </td>
              </tr>
            ))}
            {controllers.length === 0 && <tr><td className="empty" colSpan={7}>{t("stationControllers.empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {controllers.map((c) => {
        const station = stations.find((s) => s.id === c.costCenterId);
        const nozzles = (station?.pumps || []).flatMap((p) => p.nozzles.map((n) => ({ ...n, pumpNumber: p.pumpNumber })));
        return (
          <div className="panel" key={`map-${c.id}`}>
            <h3 style={{ marginTop: 0 }}>{t("stationControllers.mapTitle", { station: getOrgDisplayName(c.costCenter, i18n.language) })}</h3>
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

      {alerts.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t("stationControllers.alertsTitle")}</h3>
          <table className="ledger-table">
            <thead><tr><th>{t("stationControllers.endedAt")}</th><th>{t("stationControllers.alertDevice")}</th><th>{t("stationControllers.alertName")}</th><th>{t("stationControllers.alertState")}</th></tr></thead>
            <tbody>
              {alerts.slice(0, 50).map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.occurredAt, i18n.language)}</td><td>{a.deviceType}{a.deviceNumber ? ` ${a.deviceNumber}` : ""}</td>
                  <td>{a.name} <span className="note">({a.code})</span></td><td>{a.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t("stationControllers.commandsTitle")}</h3>
        <table className="ledger-table">
          <thead><tr><th>{t("stationControllers.endedAt")}</th><th>{t("stationTanks.station")}</th><th>{t("stationControllers.commandType")}</th><th>{t("stationControllers.ptsPump")}</th><th>{t("stationControllers.ptsNozzle")}</th><th>{t("stationControllers.commandLimit")}</th><th>{t("stationControllers.commandStatus")}</th></tr></thead>
          <tbody>
            {commands.slice(0, 50).map((x) => (
              <tr key={x.id}>
                <td>{formatDateTime(x.createdAt, i18n.language)}</td>
                <td>{getOrgDisplayName(controllers.find((c) => c.id === x.controllerId)?.costCenter, i18n.language) || "—"}</td>
                <td>{t(`stationControllers.commandTypes.${x.type}`)}</td>
                <td className="num">{x.ptsPump === 0 ? t("stationControllers.allPumps") : x.ptsPump}</td><td className="num">{x.ptsNozzle ?? "—"}</td>
                <td>{limitText(x)}</td>
                <td><span style={{ color: RESULT_COLOR[x.status] }}>{resultText(x)}</span>{x.transactionNumber != null && <div className="note">{t("stationControllers.txFromCommand", { n: x.transactionNumber })}</div>}</td>
              </tr>
            ))}
            {commands.length === 0 && <tr><td className="empty" colSpan={7}>{t("stationControllers.noCommands")}</td></tr>}
          </tbody>
        </table>
      </div>

      <FormDialog open={!!pumpDialog} title={t("stationControllers.controlTitle", { station: getOrgDisplayName(pumpDialog?.controller?.costCenter, i18n.language) || "" })} onClose={() => setPumpDialog(null)} style={{ maxWidth: 560 }}>
        {pumpDialog && (() => {
          const d = pumpDialog;
          const live = controllers.find((c) => c.id === d.controller.id) || d.controller;
          const mapped = [...new Set(live.nozzleMaps.map((m) => `${m.ptsPump}/${m.ptsNozzle}`))].join("، ");
          const set = (patch) => setPumpDialog({ ...d, ...patch });
          return (
            <>
              <p className="note">{t("stationControllers.controlNote")}</p>
              {!live.online && <p className="balance-bad">{t("stationControllers.controlOffline")}</p>}
              {mapped && <p className="note">{t("stationControllers.mappedPumps", { list: mapped })}</p>}
              <div className="form-grid">
                <label>{t("stationControllers.ptsPump")}<input type="number" min="1" max="100" value={d.ptsPump} onChange={(e) => set({ ptsPump: e.target.value })} /></label>
                <label>{t("stationControllers.nozzleOptional")}<input type="number" min="1" max="6" value={d.ptsNozzle} onChange={(e) => set({ ptsNozzle: e.target.value })} /></label>
                <label>{t("stationControllers.presetType")}<select value={d.presetType} onChange={(e) => set({ presetType: e.target.value })}>{["Amount", "Volume", "FullTank"].map((p) => <option key={p} value={p}>{t(`stationControllers.presets.${p}`)}</option>)}</select></label>
                {d.presetType !== "FullTank" && <label>{t("stationControllers.dose")}<input type="number" min="0" step="0.01" value={d.dose} onChange={(e) => set({ dose: e.target.value })} /></label>}
                <label>{t("stationControllers.priceOptional")}<input type="number" min="0" step="0.01" value={d.price} onChange={(e) => set({ price: e.target.value })} /></label>
              </div>
              {d.result && <p style={{ color: RESULT_COLOR[d.result.status], fontWeight: 600 }}>{resultText(d.result)}{d.result.transactionNumber != null ? ` — ${t("stationControllers.txFromCommand", { n: d.result.transactionNumber })}` : ""}</p>}
              {d.error && <p className="balance-bad">{d.error}</p>}
              <div className="form-btn-group">
                <button className="btn-primary" disabled={d.busy || !d.ptsPump || (d.presetType !== "FullTank" && !(Number(d.dose) > 0))} onClick={() => sendCommand("authorize")}>{d.busy ? t("stationControllers.commandResult.pending") : t("stationControllers.authorize")}</button>
                <button className="btn-ghost" disabled={d.busy || !d.ptsPump} onClick={() => sendCommand("stop")}>{t("stationControllers.stopPump")}</button>
                <button className="btn-ghost" style={{ color: "#A8432B" }} disabled={d.busy} onClick={() => sendCommand("emergency")}>{t("stationControllers.emergencyStop")}</button>
              </div>
            </>
          );
        })()}
      </FormDialog>

      <FormDialog open={!!secretView} title={t("stationControllers.secretTitle", { station: getOrgDisplayName(secretView?.controller?.costCenter, i18n.language) || "" })} onClose={() => setSecretView(null)} style={{ maxWidth: 640 }}>
        {secretView && (() => {
          const st = secretView.settings || settings || {};
          const rows = [
            ["DomainName", st.domainName || t("stationControllers.domainMissing")],
            ["Protocol", st.protocolType],
            ["Port", String(st.port)],
            ["SecretKey", secretView.secretKey],
            ...(st.uploads || []).map((u) => [`${u} → URI`, st.uri]),
            ["UploadStatusRequestsPeriodSeconds", String(st.statusPeriodSeconds)],
            ...(st.websockets ? [
              ["UseWebsocketsCommunication", "true"],
              ["WebsocketsUri", st.websockets.uri],
              ["WebsocketsPort", String(st.websockets.port)],
              ["WebsocketsPingRequestsPeriodSeconds", String(st.websockets.pingPeriodSeconds)],
            ] : []),
          ];
          return (
            <>
              <div role="status" style={{ background: "rgba(183,121,31,0.08)", border: "1px solid rgba(183,121,31,0.28)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#7A5212" }}>
                {t("stationControllers.secretOnce")}
              </div>
              <table className="ledger-table">
                <tbody>
                  {rows.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ fontFamily: "monospace", direction: "ltr", textAlign: "left" }}>{k}</td>
                      <td style={{ fontFamily: "monospace", direction: "ltr", textAlign: "left", fontWeight: k === "SecretKey" ? 700 : 400 }}>{v}</td>
                      <td className="row-actions"><button className="btn-ghost" onClick={() => copy(v)}>{t("stationControllers.copy")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">{t("stationControllers.secretNote")}</p>
              {st.websockets && <p className="note">{t("stationControllers.wsNote")}</p>}
              <div className="form-btn-group"><button className="btn-primary" onClick={() => setSecretView(null)}>{t("stationControllers.secretDone")}</button></div>
            </>
          );
        })()}
      </FormDialog>

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
