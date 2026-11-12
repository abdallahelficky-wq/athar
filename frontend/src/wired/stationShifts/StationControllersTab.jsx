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
  const [commands, setCommands] = useState([]);
  const [pumpDialog, setPumpDialog] = useState(null); // { controller, ptsPump, ptsNozzle, presetType, dose, price, result, busy }

  const load = () => Promise.all([api.listControllers(companyId), listStations(companyId), api.listTransactions(companyId), api.listAlerts(companyId).catch(() => []), api.connectionSettings().catch(() => null), api.listCommands(companyId).catch(() => [])])
    .then(([c, s, tx, al, st, cmd]) => { setControllers(c); setStations(s); setTransactions(tx); setAlerts(al); setSettings(st); setCommands(cmd); })
    .catch((e) => setError(e.message));
  useEffect(() => { if (companyId) load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    setError(""); setMessage("");
    try { await fn(); setDialog(false); setMessage(t("stationControllers.saved")); await load(); return true; }
    catch (e) { setError(e.message); return false; }
  };

  const freeStations = stations.filter((s) => !controllers.some((c) => c.costCenterId === s.id));
  const save = () => run(() => (form.id
    ? api.updateController(form.id, { name: form.name || undefined, firmwareVersion: form.firmwareVersion || undefined, silentAfterMinutes: Number(form.silentAfterMinutes) || undefined })
    : api.createController({ companyId, costCenterId: form.costCenterId, deviceSerial: form.deviceSerial, name: form.name || undefined, firmwareVersion: form.firmwareVersion || undefined, silentAfterMinutes: Number(form.silentAfterMinutes) || undefined })));

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

      {controllers.map((c) => <NozzleMapPanel key={`map-${c.id}`} c={c} station={stations.find((s) => s.id === c.costCenterId)} run={run} setError={setError} />)}

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
              ...(st.websockets.uploadStatus ? [
                ["WebsocketsUploadStatus", "true"],
                ["WebsocketsUploadStatusRequestsPeriodSeconds", String(st.websockets.statusPeriodSeconds)],
              ] : []),
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

const PRODUCT_COLOR = { gasoline_91: "#2b8a3e", gasoline_95: "#A8432B", diesel: "#B7791F" };

/**
 * ربط فوهات أثر بأرقام المضخات/الفوهات في المتحكم — بطاقة لكل طرمبة بفوهاتها، وحفظ كل التعديلات دفعة واحدة. يُطوى حين تكون كل
 * الفوهات مربوطة (الحالة المعتادة)، ويُفتح وحده إن بقيت فوهة بلا ربط. رقمان مكرَّران لفوهتين يُعلَّمان قبل الحفظ.
 */
function NozzleMapPanel({ c, station, run, setError }) {
  const { t, i18n } = useTranslation();
  const pumps = station?.pumps || [];
  const nozzles = pumps.flatMap((p) => p.nozzles.map((n) => ({ ...n, pumpNumber: p.pumpNumber })));
  const mapOf = (nozzleId) => c.nozzleMaps.find((m) => m.nozzleId === nozzleId);
  const linked = nozzles.filter((n) => mapOf(n.id)).length;
  const [open, setOpen] = useState(linked < nozzles.length);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);

  const valueOf = (n, k) => draft[n.id]?.[k] ?? mapOf(n.id)?.[k] ?? "";
  const isDirty = (n) => {
    const d = draft[n.id];
    if (!d) return false;
    const m = mapOf(n.id);
    return String(d.ptsPump ?? m?.ptsPump ?? "") !== String(m?.ptsPump ?? "") || String(d.ptsNozzle ?? m?.ptsNozzle ?? "") !== String(m?.ptsNozzle ?? "");
  };
  const dirty = nozzles.filter(isDirty);
  const slotKey = (n) => `${valueOf(n, "ptsPump")}/${valueOf(n, "ptsNozzle")}`;
  const slotCount = {};
  for (const n of nozzles) if (valueOf(n, "ptsPump") && valueOf(n, "ptsNozzle")) slotCount[slotKey(n)] = (slotCount[slotKey(n)] || 0) + 1;
  const duplicate = (n) => slotCount[slotKey(n)] > 1;
  const set = (n, k, v) => setDraft((cur) => ({ ...cur, [n.id]: { ...cur[n.id], [k]: v } }));

  const saveAll = async () => {
    if (dirty.some((n) => !Number(valueOf(n, "ptsPump")) || !Number(valueOf(n, "ptsNozzle")))) { setError(t("stationControllers.mapMissing")); return; }
    if (nozzles.some(duplicate)) { setError(t("stationControllers.mapDuplicate")); return; }
    setBusy(true);
    const ok = await run(async () => {
      // أولاً تُحرَّر الأرقام القديمة للفوهات المعدَّلة، ثم تُربط الجديدة — حتى يصح تبادل رقمين بين فوهتين
      for (const n of dirty) { const m = mapOf(n.id); if (m) await api.setNozzleMap(c.id, { ptsPump: m.ptsPump, ptsNozzle: m.ptsNozzle, nozzleId: null }); }
      for (const n of dirty) await api.setNozzleMap(c.id, { ptsPump: Number(valueOf(n, "ptsPump")), ptsNozzle: Number(valueOf(n, "ptsNozzle")), nozzleId: n.id });
    });
    if (ok) setDraft({});
    setBusy(false);
  };
  const unlink = (n) => { const m = mapOf(n.id); if (m) run(() => api.setNozzleMap(c.id, { ptsPump: m.ptsPump, ptsNozzle: m.ptsNozzle, nozzleId: null })); };

  const numInput = (n, k) => (
    <input
      type="number" min="1" inputMode="numeric" value={valueOf(n, k)} onChange={(e) => set(n, k, e.target.value)}
      aria-label={t(k === "ptsPump" ? "stationControllers.ptsPump" : "stationControllers.ptsNozzle")}
      style={{ width: 52, minWidth: 0, flex: "0 0 52px", boxSizing: "border-box", padding: "4px 6px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, direction: "ltr", borderColor: duplicate(n) ? "#A8432B" : undefined }}
    />
  );

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{t("stationControllers.mapTitle", { station: getOrgDisplayName(c.costCenter, i18n.language) })}</h3>
        <span style={{ fontSize: 12.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: linked === nozzles.length ? "#2F5D5A" : "#B7791F", background: linked === nozzles.length ? "rgba(47,93,90,0.10)" : "rgba(183,121,31,0.12)" }}>
          {linked === nozzles.length ? "✓ " : ""}{t("stationControllers.mapSummary", { linked, total: nozzles.length })}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={() => setOpen(!open)}>{open ? t("stationControllers.mapHide") : t("stationControllers.mapEdit")}</button>
      </div>
      {open && (
        <>
          <p className="note" style={{ marginBottom: 12 }}>{t("stationControllers.mapNote")}</p>
          {nozzles.length === 0 && <p className="empty">{t("stationControllers.mapNoNozzles")}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
            {pumps.map((p) => (
              <div key={p.pumpNumber} style={{ border: "1px solid var(--athar-border)", borderRadius: 12, padding: "10px 12px", background: "var(--athar-card)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("stationSetup.pumpN", { n: p.pumpNumber })}</div>
                {p.nozzles.map((raw) => {
                  const n = { ...raw, pumpNumber: p.pumpNumber };
                  const m = mapOf(n.id);
                  return (
                    <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 6, borderRadius: 8, borderInlineStart: `4px solid ${PRODUCT_COLOR[n.product] || "#9CA3AF"}`, background: isDirty(n) ? "rgba(183,121,31,0.10)" : "rgba(16,32,46,0.03)" }}>
                      <div style={{ minWidth: 72, lineHeight: 1.35 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{t(`stationSetup.products.${n.product}`)}</div>
                        <div style={{ fontSize: 11, color: "var(--athar-muted, #6B7280)", margin: "2px 0 0" }}>{t("stationSetup.nozzle")} {n.nozzleNumber}{!m && !isDirty(n) ? ` · ${t("stationControllers.notLinked")}` : ""}</div>
                      </div>
                      <span style={{ flex: 1 }} />
                      <label className="note" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>{t("stationControllers.ptsPumpShort")}{numInput(n, "ptsPump")}</label>
                      <label className="note" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>{t("stationControllers.ptsNozzleShort")}{numInput(n, "ptsNozzle")}</label>
                      {m && <button type="button" className="btn-ghost" title={t("stationControllers.unlink")} aria-label={t("stationControllers.unlink")} onClick={() => unlink(n)} style={{ padding: "2px 7px", color: "#A8432B" }}>×</button>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {nozzles.some(duplicate) && <p className="balance-bad" style={{ marginTop: 10 }}>{t("stationControllers.mapDuplicate")}</p>}
          <div className="form-btn-group" style={{ marginTop: 12 }}>
            <button className="btn-primary" disabled={!dirty.length || busy} onClick={saveAll}>{t("stationControllers.mapSaveAll", { count: dirty.length })}</button>
            {dirty.length > 0 && <button className="btn-ghost" disabled={busy} onClick={() => setDraft({})}>{t("stationControllers.mapDiscard")}</button>}
          </div>
        </>
      )}
    </div>
  );
}
