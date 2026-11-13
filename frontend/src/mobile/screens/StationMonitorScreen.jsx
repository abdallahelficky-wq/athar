import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api/stationMonitorPortal";

/**
 * شاشة مشرف المحطات في تطبيق المحطات (بوابة الموظف) — قراءة فقط:
 * - الرئيسية: أيقونة لكل محطة في الشركة: حالة الجهاز، مبيعات اليوم، الوردية المفتوحة ومبيعاتها حتى الآن، الخزانات المنخفضة والتنبيهات.
 * - محطة واحدة: الورديات المفتوحة (لكل منتج لترات ومبلغ والإجمالي)، المضخات الآن، الخزانات، التنبيهات، آخر العمليات.
 * الرئيسية تتحدّث كل 20 ثانية، والمحطة كل 5 ثوانٍ، والاستطلاع يتوقف حين تكون الصفحة مخفية.
 */
const PRODUCT_COLOR = { gasoline_91: "#2b8a3e", gasoline_95: "#A8432B", diesel: "#B7791F" };
const HEALTH_COLOR = { online: "#2b8a3e", silent: "#B7791F", never_seen: "#6B7280", inactive: "#6B7280" };
const STATE_COLOR = { filling: "#1971c2", end_of_transaction: "#B7791F", idle: "#2b8a3e", offline: "#6B7280", unknown: "#9CA3AF" };
const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const time = (v) => (v ? new Date(v).toLocaleTimeString("en-GB", { calendar: "gregory", hour: "2-digit", minute: "2-digit" }) : "—");
const N = ({ children }) => <bdi style={{ fontVariantNumeric: "tabular-nums" }}>{children}</bdi>;

function usePoll(fn, ms) {
  useEffect(() => {
    fn();
    const timer = setInterval(() => { if (!document.hidden) fn(); }, ms);
    return () => clearInterval(timer);
  }, [fn, ms]);
}

function OpenShift({ sh, t }) {
  return (
    <div className="m-card" style={{ borderInlineStart: "4px solid #1971c2" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong>{sh.employee || "—"}</strong>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{t("mobile.monitor.openedAt", { at: time(sh.openedAt) })}</span>
      </div>
      {!sh.sales ? <p className="m-empty" style={{ textAlign: "start" }}>{t("mobile.monitor.photoShift")}</p> : (
        <>
          {sh.sales.products.map((p) => (
            <div key={p.product} className="m-list-row" style={{ borderInlineStart: `3px solid ${PRODUCT_COLOR[p.product]}`, paddingInlineStart: 8 }}>
              <span>{t(`stationSetup.products.${p.product}`)}</span>
              <span><N>{fmt(p.liters)}</N> L · <N>{fmt(p.amount)}</N></span>
            </div>
          ))}
          <div className="m-list-row" style={{ fontWeight: 700 }}>
            <span>{t("mobile.monitor.shiftTotal")}</span>
            <span><N>{fmt(sh.sales.liters)}</N> L · <N>{fmt(sh.sales.amount)}</N> {t("mobile.stationShifts.sar")}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** رسائل المشرف لعمّال هذه المحطة: إرسال، وآخر الرسائل مع علامة الوصول (رآها عامل). */
function Messages({ costCenterId, t }) {
  const [list, setList] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => api.listMessages(costCenterId).then(setList).catch(() => {}), [costCenterId]);
  usePoll(load, 20000);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setError("");
    try { await api.sendMessage(costCenterId, text.trim()); setText(""); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="m-card">
      <div className="m-field">
        <textarea rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("mobile.monitor.messagePlaceholder")} style={{ width: "100%" }} />
      </div>
      {error && <p className="m-error">{error}</p>}
      <button className="m-btn" disabled={busy || !text.trim()} onClick={send}>{t("mobile.monitor.send")}</button>
      {list.map((m) => (
        <div key={m.id} className="m-list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 2, fontSize: 13 }}>
          <span>{m.body}</span>
          <span style={{ fontSize: 11.5, color: "#6b7280" }}>{time(m.createdAt)} · {m.seenAt ? `✓✓ ${t("mobile.monitor.seen", { at: time(m.seenAt) })}` : `✓ ${t("mobile.monitor.notSeen")}`}</span>
        </div>
      ))}
    </div>
  );
}

function StationDetail({ station, onBack, t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.getStationLive(station.costCenterId).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message)), [station.costCenterId]);
  usePoll(load, 5000);
  const c = data?.controller;
  return (
    <div>
      <button className="m-btn" onClick={onBack} style={{ marginBottom: 10 }}>{t("mobile.monitor.back")}</button>
      <h3 style={{ margin: "4px 0 10px" }}>⛽ {station.name}</h3>
      {error && <p className="m-error">{error}</p>}
      {!data ? <p className="m-empty">{t("common.loading")}</p> : !c ? <p className="m-empty">{t("mobile.monitor.noController")}</p> : (
        <>
          <div className="m-card">
            <div className="m-list-row"><span>{t("mobile.monitor.device")}</span><strong style={{ color: HEALTH_COLOR[c.health] }}>● {t(`stationsDashboard.health.${c.health}`)}</strong></div>
            <div className="m-list-row"><span>{t("mobile.monitor.today")}</span><span><N>{fmt(data.today.liters)}</N> L · <N>{fmt(data.today.amount)}</N></span></div>
            {Object.entries(data.today.byProduct || {}).filter(([p]) => PRODUCT_COLOR[p]).map(([p, v]) => (
              <div key={p} className="m-list-row" style={{ fontSize: 13 }}><span>{t(`stationSetup.products.${p}`)}</span><span><N>{fmt(v.liters)}</N> L · <N>{fmt(v.amount)}</N></span></div>
            ))}
          </div>

          <h4>{t("mobile.monitor.openShifts")}</h4>
          {(data.openShifts || []).length === 0 ? <p className="m-empty">{t("mobile.monitor.noOpenShift")}</p> : data.openShifts.map((sh) => <OpenShift key={sh.id} sh={sh} t={t} />)}

          <h4>{t("mobile.monitor.messages")}</h4>
          <Messages costCenterId={station.costCenterId} t={t} />

          <h4>{t("mobile.monitor.pumps")}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 12 }}>
            {(data.pumps || []).map((p) => {
              const active = p.state === "filling" || p.state === "end_of_transaction";
              const z = p.nozzles?.[0];
              return (
                <div key={p.ptsPump} className="m-card" style={{ margin: 0, padding: 10, borderTop: `4px solid ${PRODUCT_COLOR[p.product] || "#9CA3AF"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <strong>{z ? t("mobile.monitor.pumpN", { n: z.pumpNumber }) : `#${p.ptsPump}`}</strong>
                    <span style={{ color: STATE_COLOR[p.state], fontWeight: 700 }}>{t(`stationLive.states.${p.state}`)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{p.product ? t(`stationSetup.products.${p.product}`) : "—"}</div>
                  {active ? <div style={{ fontWeight: 700, fontSize: 15 }}><N>{fmt(p.volume)}</N> L · <N>{fmt(p.amount)}</N></div>
                    : p.state === "idle" ? <div style={{ fontSize: 12 }}>{t("mobile.monitor.last")} <N>{fmt(p.lastVolume)}</N> L</div> : null}
                </div>
              );
            })}
          </div>

          <h4>{t("mobile.monitor.tanks")}</h4>
          {data.tanks.map((tank) => (
            <div key={tank.tankId} className="m-card">
              <div className="m-list-row"><strong>{tank.code} · {t(`stationSetup.products.${tank.product}`)}</strong>
                <span>{!tank.probe ? t("mobile.monitor.noProbe") : !tank.probe.online ? <span style={{ color: "#A8432B" }}>{t("mobile.monitor.probeOffline")}</span> : tank.probe.fillPct != null ? `${fmt(tank.probe.fillPct, 0)}%` : "—"}</span></div>
              {tank.probe?.online && (
                <div style={{ fontSize: 12.5, color: "#374151" }}>
                  {tank.probe.productLiters != null && <div>{t("mobile.monitor.liters")}: <N>{fmt(tank.probe.productLiters, 0)}</N> / <N>{fmt(tank.capacityLiters, 0)}</N></div>}
                  <div>{t("mobile.monitor.height")}: <N>{fmt(tank.probe.productHeightMm, 1)}</N> mm · {t("mobile.monitor.water")}: <N>{fmt(tank.probe.waterHeightMm, 1)}</N> mm · <N>{fmt(tank.probe.temperatureC, 1)}</N>°C</div>
                  {tank.probe.alarms?.length > 0 && <div style={{ color: "#A8432B", fontWeight: 700 }}>{tank.probe.alarms.map((a) => t(`stationLive.alarms.${a}`)).join(" · ")}</div>}
                </div>
              )}
            </div>
          ))}

          <h4>{t("mobile.monitor.alerts")}</h4>
          {(data.alerts || []).length === 0 ? <p className="m-empty">{t("mobile.monitor.noAlerts")}</p> : (
            <div className="m-card">
              {data.alerts.map((a) => (
                <div key={a.id} className="m-list-row" style={{ fontSize: 12.5 }}>
                  <span>{a.name}{a.deviceNumber != null ? ` · ${a.deviceType} ${a.deviceNumber}` : ""}</span>
                  <span style={{ color: "#6b7280" }}>{new Date(a.occurredAt).toLocaleString("en-GB", { calendar: "gregory", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}

          <h4>{t("mobile.monitor.recent")}</h4>
          <div className="m-card">
            {(data.recent || []).slice(0, 10).map((x) => (
              <div key={x.id} className="m-list-row" style={{ fontSize: 12.5 }}>
                <span>{time(x.endedAt)} · {x.pumpNumber ? t("mobile.monitor.pumpN", { n: x.pumpNumber }) : `#${x.ptsPump}`} · {x.product ? t(`stationSetup.products.${x.product}`) : "—"}</span>
                <span><N>{fmt(x.volume)}</N> L · <N>{fmt(x.amount)}</N></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function StationMonitorScreen() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.listStations().then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message)), []);
  usePoll(load, 20000);

  if (open) return <StationDetail station={open} onBack={() => { setOpen(null); load(); }} t={t} />;
  return (
    <div>
      {error && <p className="m-error">{error}</p>}
      {!data ? <p className="m-empty">{t("common.loading")}</p> : (
        <>
          <div className="m-card">
            <div className="m-list-row" style={{ fontWeight: 700 }}><span>{t("mobile.monitor.allToday")}</span><span><N>{fmt(data.totals.todayLiters)}</N> L · <N>{fmt(data.totals.todayAmount)}</N></span></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {data.stations.map((s) => (
              <button key={s.costCenterId} className="m-card" onClick={() => setOpen(s)} style={{ margin: 0, textAlign: "start", cursor: "pointer", border: "1px solid #e5e7eb", font: "inherit", color: "inherit" }}>
                <div style={{ fontSize: 26 }}>⛽</div>
                <strong style={{ display: "block", fontSize: 14 }}>{s.name}</strong>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.controller ? HEALTH_COLOR[s.controller.health] : "#6B7280" }}>
                  ● {s.controller ? t(`stationsDashboard.health.${s.controller.health}`) : t("mobile.monitor.manual")}
                </span>
                {s.today && <div style={{ fontSize: 12.5, marginTop: 4 }}><N>{fmt(s.today.amount)}</N> · <N>{fmt(s.today.liters, 0)}</N> L</div>}
                {(s.openShifts || []).map((sh) => (
                  <div key={sh.id} style={{ fontSize: 11.5, color: "#1971c2", marginTop: 2 }}>{sh.employee || "—"}{sh.amount != null ? ` · ${fmt(sh.amount)}` : ""}</div>
                ))}
                {(s.lowTanks > 0 || s.alerts7d > 0) && (
                  <div style={{ fontSize: 11.5, color: "#A8432B", marginTop: 2 }}>
                    {s.lowTanks > 0 ? t("mobile.monitor.lowTanks", { count: s.lowTanks }) : ""}{s.lowTanks > 0 && s.alerts7d > 0 ? " · " : ""}{s.alerts7d > 0 ? t("mobile.monitor.alertsCount", { count: s.alerts7d }) : ""}
                  </div>
                )}
              </button>
            ))}
          </div>
          {data.stations.length === 0 && <p className="m-empty">{t("mobile.monitor.noStations")}</p>}
        </>
      )}
    </div>
  );
}
