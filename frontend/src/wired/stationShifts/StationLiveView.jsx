import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/stationDashboard";
import { formatDateTime } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import { getOrgDisplayName } from "../shared/accountDisplayName";

/**
 * الشاشة الحيّة لمحطة واحدة — مثل صفحة التحكم بالمضخات في واجهة PTS-2 لكن داخل أثر: كل نقطة تعبئة بحالتها الآن (خاملة / تعبّئ
 * ومعها اللترات والمبلغ وهي تزيد / انتهت العملية / غير متصلة)، مجمّعة على طرمبات أثر، ومستوى كل خزان من مسباره، ومبيعات اليوم
 * وآخر العمليات. تُستطلَع كل 3 ثوانٍ وتتوقف حين تكون الصفحة مخفية. حداثة الأرقام بقدر فترة إرسال الحالة المضبوطة في الجهاز
 * (WebsocketsUploadStatusRequestsPeriodSeconds) — راجع src/modules/stationDashboard/stationLive.service.ts.
 */
const POLL_MS = 3000;
const PRODUCT_COLOR = { gasoline_91: "#2b8a3e", gasoline_95: "#A8432B", diesel: "#B7791F" };
const STATE_STYLE = {
  filling: { bg: "rgba(25,113,194,0.10)", border: "#1971c2", color: "#1971c2" },
  end_of_transaction: { bg: "rgba(183,121,31,0.10)", border: "#B7791F", color: "#8a5a14" },
  idle: { bg: "var(--athar-card)", border: "rgba(43,138,62,0.45)", color: "#2b8a3e" },
  offline: { bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.35)", color: "#6B7280" },
  unknown: { bg: "rgba(107,114,128,0.06)", border: "rgba(107,114,128,0.25)", color: "#6B7280" },
};
const mono = { fontFamily: "'JetBrains Mono', monospace" };
/** رقم معزول الاتجاه — حتى لا يقلب النص العربي حوله ترتيب "12.82 L · 30.00" */
const Num = ({ children, style }) => <bdi style={{ ...mono, ...style }}>{children}</bdi>;
const fmt = (v, digits = 2) => (v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const fmt0 = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }));

function Dot({ color, pulse }) {
  return <span className={pulse ? "live-dot-pulse" : undefined} style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: pulse ? `0 0 0 3px ${color}33` : undefined }} />;
}

function FuelingPoint({ p, t }) {
  const st = STATE_STYLE[p.state] || STATE_STYLE.unknown;
  const productColor = PRODUCT_COLOR[p.product] || "#9CA3AF";
  const active = p.state === "filling" || p.state === "end_of_transaction";
  return (
    <div style={{ flex: "1 1 150px", minWidth: 150, background: st.bg, border: `1.5px solid ${st.border}`, borderTop: `4px solid ${productColor}`, borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <strong style={{ fontSize: 13.5 }}>{p.product ? t(`stationSetup.products.${p.product}`) : t("stationLive.unmappedPoint")}</strong>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: st.color, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Dot color={st.color} pulse={p.state === "filling"} />{t(`stationLive.states.${p.state}`)}
        </span>
      </div>
      {active ? (
        <>
          <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15 }}><Num>{fmt(p.volume)} L</Num></div>
          <div style={{ fontSize: 16, fontWeight: 600 }}><Num>{fmt(p.amount)}</Num> <span className="note">{t("stationLive.sar")}</span></div>
          <div className="note" style={{ marginTop: 4 }}>{t("stationLive.priceFlow", { price: fmt(p.price, 2), flow: p.flowRate ?? "—" })}</div>
        </>
      ) : p.state === "idle" ? (
        <>
          {p.nozzle ? <div style={{ fontWeight: 700, color: "#1971c2", marginBottom: 4 }}>{t("stationLive.nozzleUp")}</div> : null}
          <div className="note">{t("stationLive.lastSale")}</div>
          <div style={{ fontSize: 14 }}><Num>{fmt(p.lastVolume)} L</Num> · <Num>{fmt(p.lastAmount)}</Num> <span className="note">{t("stationLive.sar")}</span></div>
          {p.totalVolume != null && <div className="note" style={{ marginTop: 4 }}>{t("stationLive.totalizer")} <Num>{fmt(p.totalVolume)}</Num></div>}
        </>
      ) : (
        <div className="note" style={{ padding: "8px 0" }}>{p.state === "offline" ? t("stationLive.offlineHint") : t("stationLive.unknownHint")}</div>
      )}
      <div className="note" style={{ marginTop: 6, fontSize: 11 }}>{t("stationLive.ptsPoint", { n: p.ptsPump })}{p.request ? ` · ${p.request}` : ""}</div>
    </div>
  );
}

function TankGauge({ tank, t }) {
  const probe = tank.probe;
  const pct = probe?.fillPct;
  const color = pct == null ? "#9CA3AF" : pct < 20 ? "#A8432B" : pct < 40 ? "#B7791F" : PRODUCT_COLOR[tank.product];
  return (
    <div style={{ flex: "1 1 220px", border: "1px solid var(--athar-border)", borderRadius: 12, padding: 14, display: "flex", gap: 14, alignItems: "stretch", background: "var(--athar-card)" }}>
      <div style={{ width: 46, minHeight: 130, borderRadius: 10, border: `2px solid ${color}`, position: "relative", overflow: "hidden", background: "rgba(16,32,46,0.04)" }}>
        <div style={{ position: "absolute", insetInline: 0, bottom: 0, height: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: color, opacity: 0.85, transition: "height .6s" }} />
      </div>
      <div style={{ flex: 1, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong>{tank.code} · {t(`stationSetup.products.${tank.product}`)}</strong>
          <Num style={{ fontWeight: 700, color }}>{pct == null ? "—" : `${fmt(pct, 0)}%`}</Num>
        </div>
        {!probe ? (
          <p className="note">{tank.atgTankNumber ? t("stationLive.probeMissing") : t("stationLive.probeNotLinked")}</p>
        ) : !probe.online ? (
          <p className="note">{t("stationLive.probeOffline")}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", marginTop: 8 }}>
            <span className="note">{t("stationLive.liters")}</span><span>{probe.productLiters == null ? <span style={{ color: "#8a5a14" }}>{t("stationLive.needsCalibration")}</span> : <Num>{`${fmt0(probe.productLiters)} / ${fmt0(tank.capacityLiters)} L`}</Num>}</span>
            <span className="note">{t("stationLive.height")}</span><span><Num>{fmt(probe.productHeightMm, 1)} mm</Num></span>
            <span className="note">{t("stationLive.water")}</span><span><Num style={{ color: probe.waterHeightMm > 0 ? "#A8432B" : undefined }}>{fmt(probe.waterHeightMm, 1)} mm</Num></span>
            <span className="note">{t("stationLive.temperature")}</span><span><Num>{fmt(probe.temperatureC, 1)} °C</Num></span>
          </div>
        )}
        {probe?.alarms?.length > 0 && <div style={{ marginTop: 6, color: "#A8432B", fontWeight: 700, fontSize: 12 }}>{probe.alarms.map((a) => t(`stationLive.alarms.${a}`)).join(" · ")}</div>}
      </div>
    </div>
  );
}

export default function StationLiveView({ companyId, costCenterId, onBack }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const rootRef = useRef(null);
  const rtl = i18n.dir?.() === "rtl" || i18n.language?.startsWith("ar");

  const load = useCallback(() => {
    api.getStationLive(companyId, costCenterId).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message));
  }, [companyId, costCenterId]);

  useEffect(() => {
    load();
    const timer = setInterval(() => { setNow(Date.now()); if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const fullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => undefined);
  };

  const c = data?.controller;
  const ageSec = c?.statusAt ? Math.max(0, Math.round((now - new Date(c.statusAt).getTime()) / 1000)) : null;
  const freshness = !c ? "none" : ageSec == null ? "none" : ageSec <= 15 ? "live" : ageSec <= 120 ? "delayed" : "stale";
  const freshColor = { live: "#2b8a3e", delayed: "#B7791F", stale: "#A8432B", none: "#6B7280" }[freshness];

  // نقاط التعبئة مجمّعة على طرمبات أثر (الوجه = طرمبة)، وما لم يُربَط في مجموعة أخيرة
  const groups = [];
  for (const p of data?.pumps ?? []) {
    const pumpNumber = p.nozzles?.[0]?.pumpNumber ?? null;
    const key = pumpNumber ?? "unmapped";
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, pumpNumber, points: [] }; groups.push(g); }
    g.points.push(p);
  }
  groups.sort((a, b) => (a.pumpNumber ?? 1e9) - (b.pumpNumber ?? 1e9));
  for (const g of groups) g.points.sort((a, b) => (a.nozzles?.[0]?.nozzleNumber ?? 9) - (b.nozzles?.[0]?.nozzleNumber ?? 9));
  const filling = (data?.pumps ?? []).filter((p) => p.state === "filling");
  const offline = (data?.pumps ?? []).filter((p) => p.state === "offline" || p.state === "unknown").length;

  return (
    <div ref={rootRef} style={{ background: "var(--athar-bg, #fff)", padding: 4 }}>
      <style>{"@keyframes livePulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}} .live-dot-pulse{animation:livePulse 1.1s infinite}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {onBack && <button className="btn-ghost" onClick={onBack}>{rtl ? "→" : "←"} {t("stationsDashboard.allStations")}</button>}
        <h3 style={{ margin: 0 }}>{data ? getOrgDisplayName(data.station, i18n.language) : ""}</h3>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: freshColor }}>
          <Dot color={freshColor} pulse={freshness === "live"} />
          {t(`stationLive.freshness.${freshness}`, { seconds: ageSec })}
        </span>
        {c && <span className="note">{c.commandsOnline ? t("stationLive.commandsOn") : t("stationLive.commandsOff")}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={fullscreen}>{t("stationLive.fullscreen")}</button>
      </div>
      {error && <p className="balance-bad">{error}</p>}
      {data && !c && <p className="empty">{t("stationLive.noController")}</p>}

      {data && c && (
        <>
          <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <div className="panel kpi-card kpi-card-revenue" style={{ marginBottom: 0 }}><div className="kpi-label">{t("stationLive.todayLiters")}</div><div className="kpi-value" style={mono}>{fmt(data.today.liters)}</div><div className="note">{t("stationLive.todayCount", { count: data.today.count })}</div></div>
            <div className="panel kpi-card kpi-card-profit" style={{ marginBottom: 0 }}><div className="kpi-label">{t("stationLive.todayAmount")}</div><div className="kpi-value" style={mono}>{fmt2(data.today.amount)}</div></div>
            {["gasoline_91", "gasoline_95", "diesel"].filter((p) => data.today.byProduct[p]).map((p) => (
              <div key={p} className="panel kpi-card" style={{ marginBottom: 0, borderInlineStart: `4px solid ${PRODUCT_COLOR[p]}` }}>
                <div className="kpi-label">{t(`stationSetup.products.${p}`)}</div>
                <div className="kpi-value" style={{ fontSize: 19 }}><Num>{fmt(data.today.byProduct[p].liters)} L</Num></div>
                <div className="note">{fmt2(data.today.byProduct[p].amount)}</div>
              </div>
            ))}
            <div className="panel kpi-card kpi-card-cash" style={{ marginBottom: 0 }}><div className="kpi-label">{t("stationLive.fillingNow")}</div><div className="kpi-value">{filling.length}</div><div className="note">{t("stationLive.offlineCount", { count: offline })}</div></div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t("stationLive.openShifts")}</h3>
            {(data.openShifts || []).length === 0 && <p className="empty">{t("stationLive.noOpenShift")}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {(data.openShifts || []).map((sh) => (
                <div key={sh.id} style={{ border: "1.5px solid rgba(25,113,194,0.45)", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <strong>{sh.employee || "—"}</strong>
                    <span className="note">{t(`stationsDashboard.shiftTypes.${sh.shiftType}`)} · {t("stationLive.openedAt", { at: formatDateTime(sh.openedAt, i18n.language) })}</span>
                  </div>
                  {!sh.sales ? <p className="note">{t("stationLive.photoShift")}</p> : (
                    <>
                      {sh.sales.products.map((p) => (
                        <div key={p.product} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "3px 0", borderInlineStart: `3px solid ${PRODUCT_COLOR[p.product]}`, paddingInlineStart: 8 }}>
                          <span>{t(`stationSetup.products.${p.product}`)}</span>
                          <span><Num>{fmt(p.liters)} L</Num> · <Num>{p.amount == null ? "—" : fmt(p.amount)}</Num></span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, borderTop: "1px solid var(--athar-border)", marginTop: 6, paddingTop: 6 }}>
                        <span>{t("stationLive.shiftTotal")}</span>
                        <span><Num>{fmt(sh.sales.liters)} L</Num> · <Num>{fmt(sh.sales.amount)}</Num> <span className="note">{t("stationLive.sar")}</span></span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t("stationLive.pumps")}</h3>
            {groups.length === 0 && <p className="empty">{t("stationLive.noStatus")}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14 }}>
              {groups.map((g) => (
                <div key={g.key} style={{ border: "1px solid var(--athar-border)", borderRadius: 14, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{g.pumpNumber ? t("stationSetup.pumpN", { n: g.pumpNumber }) : t("stationLive.unmappedGroup")}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{g.points.map((p) => <FuelingPoint key={p.ptsPump} p={p} t={t} />)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t("stationsDashboard.tanks")}</h3>
            {data.tanks.length === 0 ? <p className="empty">{t("stationsDashboard.noTanks")}</p> : (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>{data.tanks.map((tank) => <TankGauge key={tank.tankId} tank={tank} t={t} />)}</div>
            )}
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t("stationLive.alerts")}</h3>
            {(data.alerts || []).length === 0 ? <p className="empty">{t("stationLive.noAlerts")}</p> : (
              <div className="lines-table-wrap">
                <table className="ledger-table">
                  <thead><tr><th>{t("stationLive.time")}</th><th>{t("stationLive.alertDevice")}</th><th>{t("stationLive.alertName")}</th><th>{t("stationLive.alertState")}</th></tr></thead>
                  <tbody>
                    {data.alerts.map((a) => (
                      <tr key={a.id}>
                        <td>{formatDateTime(a.occurredAt, i18n.language)}</td>
                        <td>{a.deviceType}{a.deviceNumber != null ? ` ${a.deviceNumber}` : ""}</td>
                        <td>{a.name}{a.code != null ? ` (${a.code})` : ""}</td>
                        <td>{a.state ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t("stationLive.recent")}</h3>
            <div className="lines-table-wrap">
              <table className="ledger-table">
                <thead><tr><th>{t("stationLive.time")}</th><th>{t("stationSetup.pump")}</th><th>{t("stationSetup.product")}</th><th>{t("stationLive.liters")}</th><th>{t("stationLive.amount")}</th><th>{t("stationLive.price")}</th></tr></thead>
                <tbody>
                  {data.recent.map((x) => (
                    <tr key={x.id}>
                      <td>{formatDateTime(x.endedAt, i18n.language)}</td>
                      <td>{x.pumpNumber ? t("stationSetup.pumpN", { n: x.pumpNumber }) : t("stationLive.ptsPoint", { n: x.ptsPump })}</td>
                      <td>{x.product ? t(`stationSetup.products.${x.product}`) : "—"}</td>
                      <td className="num">{fmt(x.volume)}</td><td className="num">{fmt(x.amount)}</td><td className="num">{fmt(x.price)}</td>
                    </tr>
                  ))}
                  {data.recent.length === 0 && <tr><td className="empty" colSpan={6}>{t("stationControllers.noTx")}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <p className="note">
            {t("stationLive.footer", { at: c.statusAt ? formatDateTime(c.statusAt, i18n.language) : "—" })}
            {c.batteryVoltageMv != null && c.batteryVoltageMv < 2500 && <span style={{ color: "#A8432B", fontWeight: 700 }}> · {t("stationLive.batteryLow")}</span>}
          </p>
        </>
      )}
    </div>
  );
}
