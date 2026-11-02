import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/stationTanks";
import { listStations } from "../../api/stationSetup";
import { listSuppliers } from "../../api/suppliers";
import { formatDate } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";

/**
 * الخزانات والتوريد: إعداد الخزانات وربط الفوهات بها، قياس الخزانات اليدوي، توريد الوقود، ومطابقة الخزانات
 * (افتتاح + مستلَم − مبيع مقابل القراءة الفعلية). كل إدخال في نافذة منبثقة؛ الإلغاء بسبب ولا حذف.
 */
const PRODUCTS = ["diesel", "gasoline_91", "gasoline_95"];
const today = () => new Date().toISOString().slice(0, 10);
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const monthStart = () => `${today().slice(0, 8)}01`;
const STATUS_COLOR = { ok: "#2F5D5A", warning: "#B7791F", breach: "#A8432B", insufficient_readings: "#6B7280" };

export default function StationTanksTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState("reconciliation");
  const [stations, setStations] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [readings, setReadings] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [recon, setRecon] = useState(null);
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(""); // "" | tank | reading | delivery | void
  const [form, setForm] = useState({});
  const [voidTarget, setVoidTarget] = useState(null);

  const productLabel = (p) => t(`stationSetup.products.${p}`);
  const tankLabel = (tk) => `${tk.code} — ${productLabel(tk.product)}`;
  const stationName = (id) => stations.find((s) => s.id === id)?.name ?? "";
  const activeTanks = useMemo(() => tanks.filter((tk) => tk.isActive), [tanks]);

  const loadBase = () => Promise.all([listStations(companyId), api.listTanks(companyId), listSuppliers(companyId).catch(() => [])])
    .then(([s, tk, sup]) => { setStations(s); setTanks(tk); setSuppliers(sup); })
    .catch((e) => setError(e.message));
  const loadReadings = () => api.listReadings(companyId, range).then(setReadings).catch((e) => setError(e.message));
  const loadDeliveries = () => api.listDeliveries(companyId, range).then(setDeliveries).catch((e) => setError(e.message));
  const loadRecon = () => api.reconcile(companyId, range.from, range.to).then(setRecon).catch((e) => setError(e.message));
  const reloadSection = () => ({ readings: loadReadings, deliveries: loadDeliveries, reconciliation: loadRecon }[section] || (() => {}))();

  useEffect(() => { if (companyId) loadBase(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (companyId) reloadSection(); }, [companyId, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (kind, initial) => { setError(""); setMessage(""); setForm(initial); setDialog(kind); };
  const close = () => { setDialog(""); setVoidTarget(null); };
  const run = async (fn, okKey) => {
    setError("");
    try { await fn(); close(); setMessage(t(okKey)); await loadBase(); await reloadSection(); }
    catch (e) { setError(e.message); }
  };

  const saveTank = () => run(() => (form.id
    ? api.updateTank(form.id, { code: form.code, capacityLiters: Number(form.capacityLiters), atgTankNumber: form.atgTankNumber ? Number(form.atgTankNumber) : null })
    : api.createTank({ companyId, costCenterId: form.costCenterId, code: form.code, product: form.product, capacityLiters: Number(form.capacityLiters), atgTankNumber: form.atgTankNumber ? Number(form.atgTankNumber) : null })), "stationTanks.saved");

  const saveReading = () => run(() => api.createReading({
    tankId: form.tankId, purpose: form.purpose, readAt: new Date(form.readAt).toISOString(), liters: Number(form.liters),
    heightMm: form.heightMm === "" || form.heightMm == null ? null : Number(form.heightMm),
    waterHeightMm: form.waterHeightMm === "" || form.waterHeightMm == null ? null : Number(form.waterHeightMm),
    note: form.note || undefined,
  }), "stationTanks.saved");

  const deliveryTanks = activeTanks.filter((tk) => tk.costCenterId === form.costCenterId);
  const saveDelivery = () => {
    const lines = deliveryTanks
      .map((tk) => ({ tankId: tk.id, noteLiters: Number(form.lines?.[tk.id]?.noteLiters || 0), receivedLiters: Number(form.lines?.[tk.id]?.receivedLiters || 0) }))
      .filter((l) => l.noteLiters > 0 || l.receivedLiters > 0);
    return run(() => api.createDelivery({
      companyId, costCenterId: form.costCenterId, supplierId: form.supplierId || null, carrierSupplierId: form.carrierSupplierId || null,
      deliveryNoteNumber: form.deliveryNoteNumber, tankerPlate: form.tankerPlate || undefined, driverName: form.driverName || undefined,
      deliveredAt: new Date(form.deliveredAt).toISOString(), note: form.note || undefined, lines,
    }), "stationTanks.saved");
  };

  const saveVoid = () => {
    if (!form.reason?.trim()) { setError(t("stationShiftsReview.reasonRequired")); return; }
    return run(() => (voidTarget.kind === "reading" ? api.voidReading(voidTarget.id, form.reason.trim()) : api.voidDelivery(voidTarget.id, form.reason.trim())), "stationTanks.voided");
  };

  const setNozzle = (nozzleId, tankId) => run(() => api.setNozzleTank(nozzleId, tankId || null), "stationTanks.saved");

  const field = (key, label, props = {}) => (
    <label>{label}<input {...props} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
  );

  const rangeBar = (
    <div className="form-btn-group" style={{ alignItems: "flex-end" }}>
      <label>{t("stationTanks.from")}<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
      <label>{t("stationTanks.to")}<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      <button className="btn-ghost" onClick={reloadSection}>{t("stationTanks.show")}</button>
    </div>
  );

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="form-btn-group" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {["reconciliation", "tanks", "readings", "deliveries"].map((s) => (
          <button key={s} className={section === s ? "btn-primary" : "btn-ghost"} onClick={() => setSection(s)}>{t(`stationTanks.sections.${s}`)}</button>
        ))}
      </div>
      {error && !dialog && <p className="balance-bad">{error}</p>}
      {message && <p className="note">{message}</p>}

      {section === "reconciliation" && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t("stationTanks.reconTitle")}</h3>
          <p className="note">{t("stationTanks.reconNote")}</p>
          {rangeBar}
          {recon?.unassignedNozzles > 0 && <p className="balance-bad">{t("stationTanks.unassignedNozzles", { count: recon.unassignedNozzles })}</p>}
          <div className="lines-table-wrap">
            <table className="ledger-table">
              <thead><tr>
                <th>{t("stationTanks.station")}</th><th>{t("stationTanks.tank")}</th><th>{t("stationTanks.opening")}</th><th>{t("stationTanks.received")}</th>
                <th>{t("stationTanks.sold")}</th><th>{t("stationTanks.expected")}</th><th>{t("stationTanks.closing")}</th><th>{t("stationTanks.variance")}</th>
                <th>{t("stationTanks.variancePct")}</th><th>{t("stationTanks.status")}</th>
              </tr></thead>
              <tbody>
                {(recon?.rows || []).map((r) => (
                  <tr key={r.tankId}>
                    <td>{r.stationName}</td><td>{r.code} — {productLabel(r.product)}</td>
                    <td className="num">{r.openingLiters == null ? "—" : fmt2(r.openingLiters)}<div className="note">{r.openingAt ? formatDate(r.openingAt, i18n.language) : ""}</div></td>
                    <td className="num">{fmt2(r.receivedLiters)}</td>
                    <td className="num">{fmt2(r.soldLiters)}</td>
                    <td className="num">{r.expectedLiters == null ? "—" : fmt2(r.expectedLiters)}</td>
                    <td className="num">{r.closingLiters == null ? "—" : fmt2(r.closingLiters)}<div className="note">{r.closingAt ? formatDate(r.closingAt, i18n.language) : ""}</div></td>
                    <td className="num" style={{ color: r.varianceLiters < 0 ? "#A8432B" : undefined }}>{r.varianceLiters == null ? "—" : fmt2(r.varianceLiters)}</td>
                    <td className="num">{r.variancePct == null ? "—" : `${fmt2(r.variancePct)}%`}</td>
                    <td><strong style={{ color: STATUS_COLOR[r.status] }}>{t(`stationTanks.statuses.${r.status}`)}</strong></td>
                  </tr>
                ))}
                {recon && recon.rows.length === 0 && <tr><td className="empty" colSpan={10}>{t("stationTanks.noTanks")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "tanks" && (
        <div className="panel">
          <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{t("stationTanks.tanksTitle")}</h3>
            <button className="btn-primary" onClick={() => open("tank", { costCenterId: stations[0]?.id || "", product: "diesel", code: "", capacityLiters: "", atgTankNumber: "" })}>+ {t("stationTanks.addTank")}</button>
          </div>
          <table className="ledger-table">
            <thead><tr><th>{t("stationTanks.station")}</th><th>{t("stationTanks.tankCode")}</th><th>{t("stationTanks.product")}</th><th>{t("stationTanks.capacity")}</th><th>{t("stationTanks.atgNumber")}</th><th>{t("stationTanks.status")}</th><th></th></tr></thead>
            <tbody>
              {tanks.map((tk) => (
                <tr key={tk.id}>
                  <td>{tk.costCenter?.name}</td><td>{tk.code}</td><td>{productLabel(tk.product)}</td><td className="num">{fmt2(tk.capacityLiters)}</td>
                  <td>{tk.atgTankNumber ?? "—"}</td><td>{tk.isActive ? t("stationTanks.active") : t("stationTanks.inactive")}</td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => open("tank", { id: tk.id, costCenterId: tk.costCenterId, product: tk.product, code: tk.code, capacityLiters: tk.capacityLiters, atgTankNumber: tk.atgTankNumber ?? "" })}>{t("stationTanks.edit")}</button>
                    <button className="btn-ghost" onClick={() => run(() => api.updateTank(tk.id, { isActive: !tk.isActive }), "stationTanks.saved")}>{tk.isActive ? t("stationTanks.deactivate") : t("stationTanks.activate")}</button>
                  </td>
                </tr>
              ))}
              {tanks.length === 0 && <tr><td className="empty" colSpan={7}>{t("stationTanks.noTanks")}</td></tr>}
            </tbody>
          </table>

          <h3>{t("stationTanks.nozzleMapTitle")}</h3>
          <p className="note">{t("stationTanks.nozzleMapNote")}</p>
          <table className="ledger-table">
            <thead><tr><th>{t("stationTanks.station")}</th><th>{t("stationSetup.pump")}</th><th>{t("stationSetup.nozzle")}</th><th>{t("stationTanks.product")}</th><th>{t("stationTanks.tank")}</th></tr></thead>
            <tbody>
              {stations.flatMap((s) => s.pumps.flatMap((p) => p.nozzles.map((n) => (
                <tr key={n.id}>
                  <td>{s.name}</td><td>{t("stationSetup.pumpN", { n: p.pumpNumber })}</td><td>{n.nozzleNumber}</td><td>{productLabel(n.product)}</td>
                  <td>
                    <select value={n.tankId || ""} onChange={(e) => setNozzle(n.id, e.target.value)}>
                      <option value="">{t("stationTanks.noTank")}</option>
                      {activeTanks.filter((tk) => tk.costCenterId === s.id && tk.product === n.product).map((tk) => <option key={tk.id} value={tk.id}>{tk.code}</option>)}
                    </select>
                  </td>
                </tr>
              ))))}
            </tbody>
          </table>
        </div>
      )}

      {section === "readings" && (
        <div className="panel">
          <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{t("stationTanks.readingsTitle")}</h3>
            <button className="btn-primary" disabled={!activeTanks.length} onClick={() => open("reading", { tankId: activeTanks[0]?.id || "", purpose: "closing", readAt: nowLocal(), liters: "", heightMm: "", waterHeightMm: "", note: "" })}>+ {t("stationTanks.addReading")}</button>
          </div>
          {rangeBar}
          <table className="ledger-table">
            <thead><tr><th>{t("stationTanks.readAt")}</th><th>{t("stationTanks.station")}</th><th>{t("stationTanks.tank")}</th><th>{t("stationTanks.purpose")}</th><th>{t("stationTanks.liters")}</th><th>{t("stationTanks.source")}</th><th>{t("stationTanks.status")}</th><th></th></tr></thead>
            <tbody>
              {readings.map((r) => (
                <tr key={r.id} style={{ opacity: r.voidedAt ? 0.5 : 1 }}>
                  <td>{new Date(r.readAt).toLocaleString(i18n.language)}</td><td>{stationName(r.tank?.costCenterId)}</td>
                  <td>{r.tank?.code} — {productLabel(r.tank?.product)}</td><td>{t(`stationTanks.purposes.${r.purpose}`)}</td>
                  <td className="num">{fmt2(r.liters)}</td><td>{t(`stationTanks.sources.${r.source}`)}</td>
                  <td>{r.voidedAt ? `${t("stationTanks.voidedLabel")} — ${r.voidReason}` : t("stationTanks.active")}</td>
                  <td>{!r.voidedAt && <button className="btn-ghost" onClick={() => { setVoidTarget({ kind: "reading", id: r.id }); open("void", { reason: "" }); }}>{t("stationTanks.void")}</button>}</td>
                </tr>
              ))}
              {readings.length === 0 && <tr><td className="empty" colSpan={8}>{t("stationTanks.noReadings")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {section === "deliveries" && (
        <div className="panel">
          <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{t("stationTanks.deliveriesTitle")}</h3>
            <button className="btn-primary" disabled={!activeTanks.length} onClick={() => open("delivery", { costCenterId: activeTanks[0]?.costCenterId || "", supplierId: "", carrierSupplierId: "", deliveryNoteNumber: "", tankerPlate: "", driverName: "", deliveredAt: nowLocal(), note: "", lines: {} })}>+ {t("stationTanks.addDelivery")}</button>
          </div>
          {rangeBar}
          <table className="ledger-table">
            <thead><tr><th>{t("stationTanks.deliveredAt")}</th><th>{t("stationTanks.station")}</th><th>{t("stationTanks.noteNumber")}</th><th>{t("stationTanks.tank")}</th><th>{t("stationTanks.noteLiters")}</th><th>{t("stationTanks.receivedLiters")}</th><th>{t("stationTanks.transitDiff")}</th><th>{t("stationTanks.status")}</th><th></th></tr></thead>
            <tbody>
              {deliveries.flatMap((dv) => dv.lines.map((l, i) => (
                <tr key={l.id} style={{ opacity: dv.status === "void" ? 0.5 : 1 }}>
                  <td>{i === 0 ? new Date(dv.deliveredAt).toLocaleString(i18n.language) : ""}</td><td>{i === 0 ? dv.costCenter?.name : ""}</td><td>{i === 0 ? dv.deliveryNoteNumber : ""}</td>
                  <td>{l.tank?.code} — {productLabel(l.tank?.product)}</td><td className="num">{fmt2(l.noteLiters)}</td><td className="num">{fmt2(l.receivedLiters)}</td>
                  <td className="num">{fmt2(Number(l.receivedLiters) - Number(l.noteLiters))}</td>
                  <td>{i === 0 ? (dv.status === "void" ? `${t("stationTanks.voidedLabel")} — ${dv.voidReason}` : t("stationTanks.confirmed")) : ""}</td>
                  <td>{i === 0 && dv.status !== "void" && <button className="btn-ghost" onClick={() => { setVoidTarget({ kind: "delivery", id: dv.id }); open("void", { reason: "" }); }}>{t("stationTanks.void")}</button>}</td>
                </tr>
              )))}
              {deliveries.length === 0 && <tr><td className="empty" colSpan={9}>{t("stationTanks.noDeliveries")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog open={dialog === "tank"} title={form.id ? t("stationTanks.editTank") : t("stationTanks.addTank")} onClose={close}>
        <div className="form-grid">
          <label>{t("stationTanks.station")}<select disabled={!!form.id} value={form.costCenterId || ""} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>{stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>{t("stationTanks.product")}<select disabled={!!form.id} value={form.product || "diesel"} onChange={(e) => setForm({ ...form, product: e.target.value })}>{PRODUCTS.map((p) => <option key={p} value={p}>{productLabel(p)}</option>)}</select></label>
          {field("code", t("stationTanks.tankCode"))}
          {field("capacityLiters", t("stationTanks.capacity"), { type: "number", min: 0 })}
          {field("atgTankNumber", t("stationTanks.atgNumber"), { type: "number", min: 1 })}
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("stationShiftsReview.cancelBtn")}</button><button className="btn-primary" disabled={!form.code || !Number(form.capacityLiters) || !form.costCenterId} onClick={saveTank}>{t("stationTanks.save")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "reading"} title={t("stationTanks.addReading")} onClose={close}>
        <div className="form-grid">
          <label>{t("stationTanks.tank")}<select value={form.tankId || ""} onChange={(e) => setForm({ ...form, tankId: e.target.value })}>{activeTanks.map((tk) => <option key={tk.id} value={tk.id}>{tk.costCenter?.name} — {tankLabel(tk)}</option>)}</select></label>
          <label>{t("stationTanks.purpose")}<select value={form.purpose || "closing"} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>{["opening", "closing", "pre_delivery", "post_delivery", "spot"].map((p) => <option key={p} value={p}>{t(`stationTanks.purposes.${p}`)}</option>)}</select></label>
          {field("readAt", t("stationTanks.readAt"), { type: "datetime-local" })}
          {field("liters", t("stationTanks.liters"), { type: "number", min: 0, step: "0.01" })}
          {field("heightMm", t("stationTanks.heightMm"), { type: "number", min: 0 })}
          {field("waterHeightMm", t("stationTanks.waterHeightMm"), { type: "number", min: 0 })}
          <label className="memo-field">{t("stationTanks.note")}<input value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("stationShiftsReview.cancelBtn")}</button><button className="btn-primary" disabled={!form.tankId || form.liters === "" || !form.readAt} onClick={saveReading}>{t("stationTanks.save")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "delivery"} title={t("stationTanks.addDelivery")} onClose={close}>
        <div className="form-grid">
          <label>{t("stationTanks.station")}<select value={form.costCenterId || ""} onChange={(e) => setForm({ ...form, costCenterId: e.target.value, lines: {} })}>{stations.filter((s) => activeTanks.some((tk) => tk.costCenterId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {field("deliveryNoteNumber", t("stationTanks.noteNumber"))}
          {field("deliveredAt", t("stationTanks.deliveredAt"), { type: "datetime-local" })}
          <label>{t("stationTanks.supplier")}<select value={form.supplierId || ""} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>{t("stationTanks.carrier")}<select value={form.carrierSupplierId || ""} onChange={(e) => setForm({ ...form, carrierSupplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {field("tankerPlate", t("stationTanks.tankerPlate"))}
          {field("driverName", t("stationTanks.driverName"))}
          <label className="memo-field">{t("stationTanks.note")}<input value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        </div>
        <table className="ledger-table">
          <thead><tr><th>{t("stationTanks.tank")}</th><th>{t("stationTanks.noteLiters")}</th><th>{t("stationTanks.receivedLiters")}</th></tr></thead>
          <tbody>
            {deliveryTanks.map((tk) => (
              <tr key={tk.id}>
                <td>{tankLabel(tk)}</td>
                {["noteLiters", "receivedLiters"].map((k) => (
                  <td key={k}><input type="number" min="0" value={form.lines?.[tk.id]?.[k] ?? ""} onChange={(e) => setForm({ ...form, lines: { ...form.lines, [tk.id]: { ...form.lines?.[tk.id], [k]: e.target.value } } })} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">{t("stationTanks.receivedNote")}</p>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("stationShiftsReview.cancelBtn")}</button><button className="btn-primary" disabled={!form.deliveryNoteNumber || !form.costCenterId} onClick={saveDelivery}>{t("stationTanks.save")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "void"} title={t("stationTanks.void")} onClose={close} style={{ maxWidth: 520 }}>
        <label>{t("stationTanks.voidReason")}<textarea rows={2} style={{ width: "100%" }} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("stationShiftsReview.cancelBtn")}</button><button className="btn-primary" onClick={saveVoid}>{t("stationShiftsReview.confirmBtn")}</button></div>
      </FormDialog>
    </div>
  );
}
