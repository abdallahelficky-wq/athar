import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/cardSettlements";
import { listStations } from "../../api/stationSetup";
import { listAccounts } from "../../api/accounts";
import { formatDate } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";
import AccountSearchSelect from "../shared/AccountSearchSelect";

/**
 * تسويات الشبكة (مدى) وبطاقات الوقود: لكل محطة ويوم — تحصيل القناة في الورديات المرحَّلة، وهل غطّته تسوية بنك أم ينتظر
 * (بعمر الأيام). تسجيل التسوية من إشعار البنك (الصافي + العمولة + ضريبتها) يُقفل ذمم القناة بقيد، والعكس بسبب.
 */
const localDay = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const today = () => localDay();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const AMBER_NOTE = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "rgba(183,121,31,0.08)", border: "1px solid rgba(183,121,31,0.28)", borderRadius: 10, padding: "10px 14px", margin: "0 0 14px", fontSize: 13, color: "#7A5212" };

export default function CardSettlementsTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [channel, setChannel] = useState("network");
  const [range, setRange] = useState(() => { const n = new Date(); return { from: localDay(new Date(n.getFullYear(), n.getMonth(), 1)), to: today() }; });
  const [stations, setStations] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [recon, setRecon] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(""); // "" | settle | reverse
  const [form, setForm] = useState({});

  const bankAccounts = useMemo(() => accounts.filter((a) => a.isBankOrCash && a.isPosting && a.isActive && !a.isArchived), [accounts]);
  const stationName = (id) => stations.find((s) => s.id === id)?.name ?? "";
  // أيام الورديات وتاريخ الإيداع أيام تقويمية مخزَّنة منتصف ليل UTC — تُعرَض بتوقيت UTC فلا تنزاح يوماً
  const fmtDay = (v) => formatDate(v, i18n.language, { timeZone: "UTC" });

  useEffect(() => {
    if (!companyId) return;
    Promise.all([listStations(companyId), listAccounts({ companyId })])
      .then(([s, a]) => { setStations(s); setAccounts(a); })
      .catch((e) => setError(e.message));
  }, [companyId]);

  const load = () => Promise.all([api.reconciliation(companyId, { ...range, channel }), api.listSettlements(companyId, { ...range, channel })])
    .then(([r, s]) => { setRecon(r); setSettlements(s); })
    .catch((e) => setError(e.message));
  useEffect(() => { if (companyId) load(); }, [companyId, channel, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setDialog("");
  const run = async (fn, okKey) => {
    setError("");
    try { await fn(); close(); setMessage(t(okKey)); await load(); }
    catch (e) { setError(e.message); }
  };

  /** نافذة التسوية: المحطة وأيامها الافتراضية = أيام غير مسوّاة لهذه المحطة في العرض (من أقدمها لأحدثها). */
  const openSettle = (costCenterId, day) => {
    const pending = (recon?.days || []).filter((r) => r.costCenterId === costCenterId && !r.settlementId).map((r) => r.day).sort();
    setError(""); setMessage("");
    setForm({
      costCenterId: costCenterId || stations[0]?.id || "",
      salesFrom: day || pending[0] || range.from, salesTo: day || pending[pending.length - 1] || range.to,
      settledOn: today(), bankAccountId: bankAccounts[0]?.id || "", netAmount: "", feeAmount: "", feeVatAmount: "", reference: "", note: "",
    });
    setDialog("settle");
  };
  // المتوقع في النافذة = تحصيل القناة في أيام الفترة المختارة للمحطة (من بيانات المطابقة المعروضة) — للعرض قبل الحفظ فقط؛
  // الخادم يعيد حسابه من الورديات المرحَّلة عند التسجيل.
  const expectedInForm = round2((recon?.days || [])
    .filter((r) => r.costCenterId === form.costCenterId && r.day >= form.salesFrom && r.day <= form.salesTo && !r.settlementId)
    .reduce((s, r) => s + r.amount, 0));
  const grossInForm = round2(Number(form.netAmount || 0) + Number(form.feeAmount || 0) + Number(form.feeVatAmount || 0));

  const saveSettle = () => run(() => api.createSettlement({
    companyId, costCenterId: form.costCenterId, channel, salesFrom: form.salesFrom, salesTo: form.salesTo, settledOn: form.settledOn,
    bankAccountId: form.bankAccountId, netAmount: Number(form.netAmount || 0), feeAmount: Number(form.feeAmount || 0), feeVatAmount: Number(form.feeVatAmount || 0),
    reference: form.reference || undefined, note: form.note || undefined,
  }), "cardSettlements.savedOk");

  const saveReverse = () => {
    if (!form.reason?.trim()) { setError(t("stationShiftsReview.reasonRequired")); return; }
    return run(() => api.reverseSettlement(form.id, form.reason.trim()), "cardSettlements.reversedOk");
  };

  const presets = (() => {
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6);
    return [
      { key: "last7", from: localDay(weekAgo), to: today() },
      { key: "thisMonth", from: localDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: today() },
      { key: "lastMonth", from: localDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: localDay(new Date(now.getFullYear(), now.getMonth(), 0)) },
    ];
  })();

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;
  const summary = recon?.summary || [];
  const pendingShifts = summary.reduce((s, r) => s + r.pendingShifts, 0);
  const sum = (key) => round2(summary.reduce((s, r) => s + r[key], 0));
  const kpis = [
    { key: "sales", value: sum("sales"), tone: "revenue" },
    { key: "unsettled", value: sum("unsettled"), tone: "receivable" },
    { key: "settledGross", value: sum("settledGross"), tone: "cash" },
    { key: "fees", value: sum("fees"), tone: "payable" },
    { key: "ledgerBalance", value: sum("ledgerBalance"), tone: "profit" },
  ];

  return (
    <div>
      <div className="panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{t("cardSettlements.title")}</h3>
          <button className="btn-primary" onClick={() => openSettle("", "")} disabled={!stations.length}>+ {t("cardSettlements.record")}</button>
        </div>
        <p className="note">{t("cardSettlements.note")}</p>

        <div className="form-btn-group" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {["network", "fuel_card"].map((c) => (
            <button key={c} type="button" className={channel === c ? "btn-primary" : "btn-ghost"} onClick={() => setChannel(c)}>{t(`cardSettlements.channels.${c}`)}</button>
          ))}
          <span style={{ width: 12 }} />
          {presets.map((p) => (
            <button key={p.key} type="button" className={range.from === p.from && range.to === p.to ? "btn-primary" : "btn-ghost"} style={{ padding: "5px 12px", fontSize: 12.5 }} onClick={() => setRange({ from: p.from, to: p.to })}>
              {t(`stationTanks.presets.${p.key}`)}
            </button>
          ))}
        </div>
        <div className="filter-bar" style={{ maxWidth: 420 }}>
          <label>{t("stationTanks.from")}<input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
          <label>{t("stationTanks.to")}<input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
        </div>

        {error && !dialog && <p className="balance-bad">{error}</p>}
        {message && <p className="note">{message}</p>}
        {pendingShifts > 0 && <div role="status" style={AMBER_NOTE}>⚠ {t("cardSettlements.pendingShifts", { count: pendingShifts })}</div>}

        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          {kpis.map((k) => (
            <div key={k.key} className={`kpi-card kpi-card-${k.tone}`} style={{ borderRadius: 12 }}>
              <div className="kpi-label">{t(`cardSettlements.kpi.${k.key}`)}</div>
              <div className="kpi-value">{fmt2(k.value)}</div>
            </div>
          ))}
        </div>

        {summary.length > 1 && (
          <div className="lines-table-wrap" style={{ marginBottom: 16 }}>
            <table className="ledger-table">
              <thead><tr>
                <th>{t("cardSettlements.station")}</th><th>{t("cardSettlements.kpi.sales")}</th><th>{t("cardSettlements.kpi.unsettled")}</th>
                <th>{t("cardSettlements.oldest")}</th><th>{t("cardSettlements.kpi.settledGross")}</th><th>{t("cardSettlements.difference")}</th><th>{t("cardSettlements.kpi.ledgerBalance")}</th>
              </tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.costCenterId}>
                    <td>{s.stationName}</td><td className="num">{fmt2(s.sales)}</td><td className="num">{fmt2(s.unsettled)}</td>
                    <td>{s.unsettledDays ? t("cardSettlements.daysAgo", { count: s.oldestUnsettledDays }) : "—"}</td>
                    <td className="num">{fmt2(s.settledGross)}</td>
                    <td className="num" style={{ color: s.difference < 0 ? "#A8432B" : undefined }}>{fmt2(s.difference)}</td>
                    <td className="num">{fmt2(s.ledgerBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h4 className="sub-head">{t("cardSettlements.daysTitle")}</h4>
        <div className="lines-table-wrap">
          <table className="ledger-table">
            <thead><tr>
              <th>{t("cardSettlements.day")}</th><th>{t("cardSettlements.station")}</th><th>{t("cardSettlements.shifts")}</th>
              <th>{t("cardSettlements.amount")}</th><th>{t("cardSettlements.status")}</th><th></th>
            </tr></thead>
            <tbody>
              {(recon?.days || []).map((r) => (
                <tr key={`${r.costCenterId}-${r.day}`}>
                  <td>{fmtDay(r.day)}</td><td>{r.stationName}</td><td className="num">{r.shiftCount}</td>
                  <td className="num">{fmt2(r.amount)}</td>
                  <td>
                    {r.settlementId
                      ? <strong style={{ color: "#2F5D5A" }}>✓ {t("cardSettlements.settled")}</strong>
                      : <strong style={{ color: r.ageDays > 3 ? "#A8432B" : "#B7791F" }}>{t("cardSettlements.awaiting", { count: r.ageDays })}</strong>}
                  </td>
                  <td className="row-actions">
                    {!r.settlementId && <button className="btn-ghost" onClick={() => openSettle(r.costCenterId, r.day)}>{t("cardSettlements.settleDay")}</button>}
                  </td>
                </tr>
              ))}
              {recon && recon.days.length === 0 && <tr><td className="empty" colSpan={6}>{t("cardSettlements.noDays")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t("cardSettlements.listTitle")}</h3>
        <div className="lines-table-wrap">
          <table className="ledger-table">
            <thead><tr>
              <th>{t("cardSettlements.settledOn")}</th><th>{t("cardSettlements.station")}</th><th>{t("cardSettlements.salesDays")}</th>
              <th>{t("cardSettlements.expected")}</th><th>{t("cardSettlements.net")}</th><th>{t("cardSettlements.fees")}</th><th>{t("cardSettlements.gross")}</th>
              <th>{t("cardSettlements.difference")}</th><th>{t("cardSettlements.entryNumber")}</th><th>{t("cardSettlements.status")}</th><th></th>
            </tr></thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id} style={s.status === "reversed" ? { opacity: 0.6 } : undefined}>
                  <td>{fmtDay(s.settledOn)}{s.reference && <div className="note">{s.reference}</div>}</td>
                  <td>{stationName(s.costCenterId)}<div className="note">{s.bankAccount?.code} — {s.bankAccount?.name}</div></td>
                  <td>{s.salesFrom === s.salesTo ? fmtDay(s.salesFrom) : `${fmtDay(s.salesFrom)} – ${fmtDay(s.salesTo)}`}</td>
                  <td className="num">{fmt2(s.expectedAmount)}</td>
                  <td className="num">{fmt2(s.netAmount)}</td>
                  <td className="num">{fmt2(Number(s.feeAmount) + Number(s.feeVatAmount))}</td>
                  <td className="num">{fmt2(s.grossAmount)}</td>
                  <td className="num" style={{ color: s.difference < 0 ? "#A8432B" : undefined }}>{fmt2(s.difference)}</td>
                  <td>{s.entryNumber || "—"}{s.reversalEntryNumber && <div className="note">↺ {s.reversalEntryNumber}</div>}</td>
                  <td>{t(`cardSettlements.statuses.${s.status}`)}{s.reverseReason && <div className="note">{s.reverseReason}</div>}</td>
                  <td className="row-actions">
                    {s.status === "posted" && <button className="btn-ghost" onClick={() => { setError(""); setForm({ id: s.id, reason: "" }); setDialog("reverse"); }}>{t("cardSettlements.reverse")}</button>}
                  </td>
                </tr>
              ))}
              {settlements.length === 0 && <tr><td className="empty" colSpan={11}>{t("cardSettlements.noSettlements")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <FormDialog open={dialog === "settle"} title={`${t("cardSettlements.record")} — ${t(`cardSettlements.channels.${channel}`)}`} onClose={close} style={{ maxWidth: 620 }}>
        <div className="form-grid">
          <label>{t("cardSettlements.station")}
            <select value={form.costCenterId || ""} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>{t("cardSettlements.settledOn")}<input type="date" value={form.settledOn || ""} onChange={(e) => setForm({ ...form, settledOn: e.target.value })} /></label>
          <label>{t("cardSettlements.salesFrom")}<input type="date" value={form.salesFrom || ""} onChange={(e) => setForm({ ...form, salesFrom: e.target.value })} /></label>
          <label>{t("cardSettlements.salesTo")}<input type="date" value={form.salesTo || ""} onChange={(e) => setForm({ ...form, salesTo: e.target.value })} /></label>
          <label style={{ gridColumn: "1 / -1" }}>{t("cardSettlements.bankAccount")}
            <AccountSearchSelect accounts={bankAccounts} value={form.bankAccountId} onChange={(id) => setForm({ ...form, bankAccountId: id })} />
          </label>
          <label>{t("cardSettlements.net")}<input type="number" step="0.01" min="0" value={form.netAmount ?? ""} onChange={(e) => setForm({ ...form, netAmount: e.target.value })} /></label>
          <label>{t("cardSettlements.reference")}<input value={form.reference || ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
          <label>{t("cardSettlements.fee")}
            <input type="number" step="0.01" min="0" value={form.feeAmount ?? ""} onChange={(e) => setForm({ ...form, feeAmount: e.target.value, feeVatAmount: e.target.value === "" ? "" : String(round2(Number(e.target.value) * 0.15)) })} />
          </label>
          <label>{t("cardSettlements.feeVat")}<input type="number" step="0.01" min="0" value={form.feeVatAmount ?? ""} onChange={(e) => setForm({ ...form, feeVatAmount: e.target.value })} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, background: "var(--athar-bg)", border: "1px solid var(--athar-border)", borderRadius: 10, padding: "10px 14px", margin: "12px 0" }}>
          <div><div className="note">{t("cardSettlements.expected")}</div><strong>{fmt2(expectedInForm)}</strong></div>
          <div><div className="note">{t("cardSettlements.gross")}</div><strong>{fmt2(grossInForm)}</strong></div>
          <div><div className="note">{t("cardSettlements.difference")}</div>
            <strong style={{ color: round2(grossInForm - expectedInForm) < 0 ? "#A8432B" : round2(grossInForm - expectedInForm) > 0 ? "#B7791F" : "#2F5D5A" }}>{fmt2(round2(grossInForm - expectedInForm))}</strong>
          </div>
        </div>
        <p className="note">{t("cardSettlements.entryNote")}</p>
        <label>{t("stationTanks.note")}<input value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("stationShiftsReview.cancelBtn")}</button><button className="btn-primary" onClick={saveSettle}>{t("cardSettlements.save")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "reverse"} title={t("cardSettlements.reverseTitle")} onClose={close} style={{ maxWidth: 520 }}>
        <label>{t("cardSettlements.reverseReason")}<textarea rows={2} style={{ width: "100%" }} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("stationShiftsReview.cancelBtn")}</button><button className="btn-primary" onClick={saveReverse}>{t("stationShiftsReview.confirmBtn")}</button></div>
      </FormDialog>
    </div>
  );
}
