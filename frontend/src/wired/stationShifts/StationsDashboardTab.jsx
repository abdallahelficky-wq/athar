import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import * as api from "../../api/stationDashboard";
import { formatDate, formatDateTime } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import { CHART_GRID, CHART_AXIS, CHART_FONT, chartTooltipStyle, colorAt } from "../dashboard/chartTheme";
import StationLiveView from "./StationLiveView";

/**
 * لوحة إدارة محطات الوقود: كل المحطات في شاشة واحدة (إجماليات، اتجاه يومي، بطاقة لكل محطة)، والضغط على المحطة يفتح صفحتها
 * (مبيعات بالمنتج يومياً، مبيعات اليوم بالساعة من المتحكم، منحنى كل خزان، الورديات، التوريدات، التنبيهات). الأرقام من الورديات
 * المعتمدة/المرحَّلة والخزانات والمتحكمات كما سجّلها النظام — راجع src/modules/stationDashboard.
 */
const PRODUCTS = ["gasoline_91", "gasoline_95", "diesel"];
const PRODUCT_COLOR = { gasoline_91: "#2b8a3e", gasoline_95: "#A8432B", diesel: "#B7791F" };
const HEALTH_COLOR = { online: "#2b8a3e", silent: "#A8432B", never_seen: "#6B7280", inactive: "#6B7280" };
const axisProps = { tick: { fontSize: 11.5, fill: CHART_AXIS, fontFamily: CHART_FONT }, axisLine: { stroke: CHART_GRID } };
const localDay = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const fmt0 = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

function Pill({ color, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color, background: `${color}14`, border: `1px solid ${color}40`, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />{children}
    </span>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`panel kpi-card${tone ? ` kpi-card-${tone}` : ""}`} style={{ marginBottom: 0 }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="note" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/** شريط امتلاء الخزان — أحمر تحت 20%، كهرماني تحت 40%. */
function TankBar({ tank, t, compact }) {
  const pct = tank.fillPct ?? 0;
  const color = tank.fillPct == null ? "#9CA3AF" : pct < 20 ? "#A8432B" : pct < 40 ? "#B7791F" : PRODUCT_COLOR[tank.product];
  return (
    <div style={{ marginBottom: compact ? 6 : 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
        <span><strong>{tank.code}</strong> · {t(`stationSetup.products.${tank.product}`)}</span>
        <bdi style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {tank.liters != null
            ? `${fmt0(tank.liters)} L · ${tank.fillPct}%`
            : tank.probe?.online && tank.probe.productHeightMm != null
              ? `${fmt0(tank.probe.productHeightMm)} mm${tank.fillPct != null ? ` · ${tank.fillPct}%` : ""}`
              : t("stationsDashboard.noReading")}
        </bdi>
      </div>
      <div style={{ height: compact ? 6 : 10, background: "rgba(16,32,46,0.08)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color, borderRadius: 999, transition: "width .3s" }} />
      </div>
      {tank.probe?.online && (
        <div className="note" style={{ fontSize: 11.5, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {tank.liters != null && tank.probe.productHeightMm != null && <span>{t("stationsDashboard.probeHeight")} <bdi>{fmt0(tank.probe.productHeightMm)} mm</bdi></span>}
          {tank.probe.waterHeightMm != null && <span style={{ color: tank.probe.waterHeightMm > 0 ? "#A8432B" : undefined }}>{t("stationsDashboard.probeWater")} <bdi>{tank.probe.waterHeightMm} mm</bdi></span>}
          {tank.probe.temperatureC != null && <span><bdi>{tank.probe.temperatureC} °C</bdi></span>}
          {tank.liters == null && <span>{t("stationsDashboard.probeNoVolume")}</span>}
          {tank.probe.alarms?.length > 0 && <span style={{ color: "#A8432B", fontWeight: 700 }}>{tank.probe.alarms.map((a) => t(`stationLive.alarms.${a}`)).join(" · ")}</span>}
        </div>
      )}
    </div>
  );
}

export default function StationsDashboardTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState({ from: localDay(), to: localDay() });
  const [selected, setSelected] = useState(null);
  // الشاشة الحيّة لمحطة — قابلة للفتح برابط مباشر (?live=<المحطة>) لعرضها على شاشة في المحطة أو المكتب
  const [live, setLiveState] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("live"); } catch { return null; }
  });
  const setLive = (id) => {
    setLiveState(id);
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("live", id); else url.searchParams.delete("live");
      window.history.replaceState(window.history.state, "", url);
    } catch { /* الرابط للراحة فقط */ }
  };
  const [overview, setOverview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fmtDay = (v) => formatDate(v, i18n.language, { timeZone: "UTC", day: "numeric", month: "short" });
  const productLabel = (p) => t(`stationSetup.products.${p}`);

  const presets = useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6);
    return [
      { key: "today", from: localDay(now), to: localDay(now) },
      { key: "yesterday", from: localDay(yesterday), to: localDay(yesterday) },
      { key: "last7", from: localDay(weekAgo), to: localDay(now) },
      { key: "thisMonth", from: localDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDay(now) },
    ];
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setError(""); setLoading(true);
    const req = selected ? api.getStation(companyId, selected, range.from, range.to).then(setDetail) : api.getOverview(companyId, range.from, range.to).then(setOverview);
    req.catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [companyId, selected, range.from, range.to]);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;
  if (live) return <StationLiveView companyId={companyId} costCenterId={live} onBack={() => setLive(null)} />;

  const filter = (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
      <div className="form-btn-group" style={{ gap: 6, flexWrap: "wrap" }}>
        {presets.map((p) => (
          <button key={p.key} type="button" className={range.from === p.from && range.to === p.to ? "btn-primary" : "btn-ghost"} style={{ padding: "5px 12px", fontSize: 12.5 }} onClick={() => setRange({ from: p.from, to: p.to })}>
            {t(`stationsDashboard.presets.${p.key}`)}
          </button>
        ))}
      </div>
      <div className="filter-bar" style={{ maxWidth: 380, marginBottom: 0, flex: "1 1 280px" }}>
        <label>{t("stationTanks.from")}<input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
        <label>{t("stationTanks.to")}<input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
      </div>
      {loading && <span className="note">{t("stationsDashboard.loading")}</span>}
    </div>
  );

  // ===== صفحة محطة واحدة =====
  if (selected) {
    const s = detail?.station;
    const sameStation = detail && s?.costCenterId === selected;
    const hourly = s?.today?.hourly?.filter((h, i, arr) => h.liters > 0 || arr.slice(0, i).some((x) => x.liters > 0)) ?? [];
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <button className="btn-ghost" onClick={() => { setSelected(null); setDetail(null); }}>{i18n.dir?.() === "rtl" || i18n.language?.startsWith("ar") ? "→" : "←"} {t("stationsDashboard.allStations")}</button>
          <h3 style={{ margin: 0 }}>{s?.name ?? ""}</h3>
          {sameStation && (s.controller
            ? <Pill color={HEALTH_COLOR[s.controller.health]}>{t(`stationsDashboard.health.${s.controller.health}`)}</Pill>
            : <Pill color="#6B7280">{t("stationsDashboard.manualOnly")}</Pill>)}
          {sameStation && s.controller && <button type="button" className="btn-primary" style={{ padding: "5px 14px" }} onClick={() => setLive(selected)}>{t("stationLive.open")}</button>}
        </div>
        {filter}
        {error && <p className="balance-bad">{error}</p>}
        {sameStation && (
          <>
            <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
              <Kpi tone="revenue" label={t("stationsDashboard.kpi.liters")} value={fmt0(s.liters)} sub={t("stationsDashboard.kpi.actualSub", { tx: s.controllerTransactions, count: s.shifts })} />
              <Kpi tone="profit" label={t("stationsDashboard.kpi.value")} value={fmt2(s.value)} sub={t("stationsDashboard.kpi.approvedSub", { liters: fmt0(s.approved.liters), value: fmt2(s.approved.value) })} />
              <Kpi tone="cash" label={t("stationsDashboard.kpi.cash")} value={fmt2(s.collections.cash)} sub={`${t("stationsDashboard.kpi.network")} ${fmt2(s.collections.network)}`} />
              <Kpi tone="receivable" label={t("stationsDashboard.kpi.today")} value={s.today ? fmt0(s.today.liters) : "—"} sub={s.today ? t("stationsDashboard.kpi.todaySub", { count: s.today.count, amount: fmt2(s.today.amount) }) : t("stationsDashboard.kpi.noController")} />
              <Kpi tone="payable" label={t("stationsDashboard.kpi.pending")} value={s.awaitingReview + s.awaitingPost} sub={t("stationsDashboard.kpi.pendingSub", { review: s.awaitingReview, post: s.awaitingPost })} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
              <div className="panel chart-panel">
                <h3 style={{ marginTop: 0 }}>{t("stationsDashboard.dailyByProduct")}</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={detail.daily}>
                    <CartesianGrid stroke={CHART_GRID} vertical={false} />
                    <XAxis dataKey="day" tickFormatter={fmtDay} {...axisProps} />
                    <YAxis {...axisProps} width={56} tickFormatter={fmt0} />
                    <Tooltip {...chartTooltipStyle} labelFormatter={fmtDay} formatter={(v) => `${fmt0(v)} L`} />
                    <Legend wrapperStyle={{ fontFamily: CHART_FONT, fontSize: 12 }} />
                    {PRODUCTS.map((p) => <Bar key={p} dataKey={p} name={productLabel(p)} stackId="p" fill={PRODUCT_COLOR[p]} radius={p === "diesel" ? [4, 4, 0, 0] : 0} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="panel chart-panel">
                <h3 style={{ marginTop: 0 }}>{t("stationsDashboard.todayHourly")}</h3>
                {hourly.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={hourly}>
                      <defs><linearGradient id="hourFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d4af37" stopOpacity={0.45} /><stop offset="100%" stopColor="#d4af37" stopOpacity={0.03} /></linearGradient></defs>
                      <CartesianGrid stroke={CHART_GRID} vertical={false} />
                      <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} {...axisProps} />
                      <YAxis {...axisProps} width={50} tickFormatter={fmt0} />
                      <Tooltip {...chartTooltipStyle} labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`} formatter={(v) => `${fmt0(v)} L`} />
                      <Area type="monotone" dataKey="liters" name={t("stationsDashboard.kpi.liters")} stroke="#b8860b" strokeWidth={2} fill="url(#hourFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="empty" style={{ padding: "60px 0" }}>{s.controller ? t("stationsDashboard.noSalesToday") : t("stationsDashboard.hourlyNeedsController")}</p>}
              </div>
            </div>

            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{t("stationsDashboard.tanks")}</h3>
              {detail.tankSeries.length === 0 ? <p className="empty">{t("stationsDashboard.noTanks")}</p> : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                  {detail.tankSeries.map((series) => {
                    const tank = s.tanks.find((x) => x.tankId === series.tankId);
                    return (
                      <div key={series.tankId} style={{ border: "1px solid var(--athar-border)", borderRadius: 12, padding: 14 }}>
                        <TankBar tank={tank} t={t} />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12.5, marginBottom: 8 }}>
                          <div><span className="note">{t("stationsDashboard.capacity")}</span><div>{fmt0(tank.capacityLiters)} L</div></div>
                          <div><span className="note">{t("stationsDashboard.cover")}</span><div style={{ color: tank.daysOfCover != null && tank.daysOfCover < 2 ? "#A8432B" : undefined }}>{tank.daysOfCover == null ? "—" : t("stationsDashboard.days", { count: tank.daysOfCover })}</div></div>
                          <div><span className="note">{t("stationsDashboard.avgDaily")}</span><div>{fmt0(tank.avgDailySold)} L</div></div>
                          <div><span className="note">{t("stationsDashboard.lastReading")}</span><div>{tank.readAt ? formatDateTime(tank.readAt, i18n.language) : "—"}{tank.source && <span className="note"> · {t(`stationTanks.sources.${tank.source}`)}</span>}</div></div>
                          {tank.probe?.online && (
                            <>
                              <div><span className="note">{t("stationsDashboard.probeHeight")}</span><div><bdi>{tank.probe.productHeightMm ?? "—"} mm</bdi></div></div>
                              <div><span className="note">{t("stationsDashboard.probeWater")}</span><div style={{ color: tank.probe.waterHeightMm > 0 ? "#A8432B" : undefined }}><bdi>{tank.probe.waterHeightMm ?? "—"} mm</bdi></div></div>
                              <div><span className="note">{t("stationLive.temperature")}</span><div><bdi>{tank.probe.temperatureC ?? "—"} °C</bdi></div></div>
                              <div><span className="note">{t("stationsDashboard.probeVolume")}</span><div>{tank.probe.productLiters != null ? <bdi>{fmt0(tank.probe.productLiters)} L</bdi> : t("stationLive.needsCalibration")}</div></div>
                            </>
                          )}
                        </div>
                        {series.points.length > 1 && (
                          <ResponsiveContainer width="100%" height={120}>
                            <AreaChart data={series.points.map((p) => ({ ...p, t: new Date(p.at).getTime() }))}>
                              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
                              <YAxis hide domain={[0, series.capacityLiters]} />
                              <Tooltip {...chartTooltipStyle} labelFormatter={(v) => formatDateTime(new Date(v), i18n.language)} formatter={(v) => `${fmt0(v)} L`} />
                              <Area type="stepAfter" dataKey="liters" name={series.code} stroke={PRODUCT_COLOR[series.product]} fill={PRODUCT_COLOR[series.product]} fillOpacity={0.12} strokeWidth={2} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
              <div className="panel">
                <h3 style={{ marginTop: 0 }}>{t("stationsDashboard.shifts")}</h3>
                <div className="lines-table-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>{t("stationsDashboard.date")}</th><th>{t("stationsDashboard.shiftType")}</th><th>{t("stationsDashboard.worker")}</th><th>{t("stationsDashboard.status")}</th><th>{t("stationsDashboard.kpi.cash")}</th></tr></thead>
                    <tbody>
                      {detail.shifts.map((x) => (
                        <tr key={x.id}>
                          <td>{fmtDay(x.shiftDate)}</td><td>{t(`stationsDashboard.shiftTypes.${x.shiftType}`)}</td><td>{x.employee || "—"}</td>
                          <td>{t(`stationsDashboard.shiftStatuses.${x.status}`)}</td><td className="num">{x.cash == null ? "—" : fmt2(x.cash)}</td>
                        </tr>
                      ))}
                      {detail.shifts.length === 0 && <tr><td className="empty" colSpan={5}>{t("stationsDashboard.noShifts")}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="panel">
                <h3 style={{ marginTop: 0 }}>{t("stationsDashboard.deliveries")}</h3>
                <div className="lines-table-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>{t("stationsDashboard.date")}</th><th>{t("stationTanks.noteNumber")}</th><th>{t("stationTanks.tank")}</th><th>{t("stationTanks.receivedLiters")}</th></tr></thead>
                    <tbody>
                      {detail.deliveries.flatMap((x) => x.lines.map((l, i) => (
                        <tr key={`${x.id}-${i}`}>
                          <td>{i === 0 ? formatDateTime(x.deliveredAt, i18n.language) : ""}</td><td>{i === 0 ? x.deliveryNoteNumber : ""}</td>
                          <td>{l.tank} · {productLabel(l.product)}</td><td className="num">{fmt0(l.receivedLiters)}</td>
                        </tr>
                      )))}
                      {detail.deliveries.length === 0 && <tr><td className="empty" colSpan={4}>{t("stationTanks.noDeliveries")}</td></tr>}
                    </tbody>
                  </table>
                </div>
                {detail.alerts.length > 0 && (
                  <>
                    <h3>{t("stationControllers.alertsTitle")}</h3>
                    <table className="ledger-table">
                      <tbody>
                        {detail.alerts.map((a) => (
                          <tr key={a.id}><td>{formatDateTime(a.occurredAt, i18n.language)}</td><td>{a.deviceType}{a.deviceNumber ? ` ${a.deviceNumber}` : ""}</td><td>{a.name}</td><td>{a.state}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ===== كل المحطات =====
  const o = overview;
  const tot = o?.totals;
  return (
    <div>
      {filter}
      {error && <p className="balance-bad">{error}</p>}
      {o && (
        <>
          <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <Kpi tone="revenue" label={t("stationsDashboard.kpi.liters")} value={fmt0(tot.liters)} sub={t("stationsDashboard.kpi.actualSub", { tx: tot.controllerTransactions, count: tot.shifts })} />
            <Kpi tone="profit" label={t("stationsDashboard.kpi.value")} value={fmt2(tot.value)} sub={t("stationsDashboard.kpi.approvedSub", { liters: fmt0(tot.approvedLiters), value: fmt2(tot.approvedValue) })} />
            <Kpi tone="cash" label={t("stationsDashboard.kpi.cash")} value={fmt2(tot.cash)} sub={`${t("stationsDashboard.kpi.network")} ${fmt2(tot.network)} · ${t("stationsDashboard.kpi.fuelCard")} ${fmt2(tot.fuelCard)}`} />
            <Kpi tone="receivable" label={t("stationsDashboard.kpi.today")} value={o.stations.some((x) => x.controller) ? fmt0(tot.todayLiters) : "—"} sub={o.stations.some((x) => x.controller) ? fmt2(tot.todayAmount) : t("stationsDashboard.kpi.noController")} />
            <Kpi tone="payable" label={t("stationsDashboard.kpi.attention")} value={tot.awaitingReview + tot.awaitingPost + tot.lowTanks} sub={t("stationsDashboard.kpi.attentionSub", { review: tot.awaitingReview, post: tot.awaitingPost, low: tot.lowTanks })} />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            {PRODUCTS.map((p) => (
              <div key={p} style={{ flex: "1 1 180px", border: "1px solid var(--athar-border)", borderInlineStart: `4px solid ${PRODUCT_COLOR[p]}`, borderRadius: 10, padding: "10px 14px", background: "var(--athar-card)" }}>
                <div className="note">{productLabel(p)}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 17 }}>{fmt0(tot.products[p].liters)} L</div>
                <div className="note">{fmt2(tot.products[p].value)}</div>
              </div>
            ))}
          </div>

          {o.daily.length > 1 && o.stations.length > 0 && (
            <div className="panel chart-panel">
              <h3 style={{ marginTop: 0 }}>{t("stationsDashboard.dailyByStation")}</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={o.daily}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="day" tickFormatter={fmtDay} {...axisProps} />
                  <YAxis {...axisProps} width={56} tickFormatter={fmt0} />
                  <Tooltip {...chartTooltipStyle} labelFormatter={fmtDay} formatter={(v) => `${fmt0(v)} L`} />
                  <Legend wrapperStyle={{ fontFamily: CHART_FONT, fontSize: 12 }} />
                  {o.stations.map((st, i) => <Bar key={st.costCenterId} dataKey={st.costCenterId} name={st.name} stackId="s" fill={colorAt(i)} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <h3 style={{ margin: "8px 0 12px" }}>{t("stationsDashboard.stations")}</h3>
          {o.stations.length === 0 && <p className="empty">{t("stationsDashboard.noStations")}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 16 }}>
            {o.stations.map((st) => (
              <div
                key={st.costCenterId}
                role="button"
                tabIndex={0}
                className="panel kpi-card"
                onClick={() => setSelected(st.costCenterId)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelected(st.costCenterId); } }}
                style={{ textAlign: "start", cursor: "pointer", marginBottom: 0, display: "block", width: "100%" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                  <strong style={{ fontSize: 15.5 }}>{st.name}</strong>
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {st.controller && (
                      <button
                        type="button"
                        className="btn-ghost"
                        title={t("stationLive.open")}
                        aria-label={t("stationLive.open")}
                        onClick={(e) => { e.stopPropagation(); setLive(st.costCenterId); }}
                        style={{ padding: "2px 10px", fontSize: 12, fontWeight: 700, color: "#1971c2", border: "1px solid rgba(25,113,194,0.35)", borderRadius: 999 }}
                      >
                        ◉ {t("stationLive.liveShort")}
                      </button>
                    )}
                    {st.controller
                      ? <Pill color={HEALTH_COLOR[st.controller.health]}>{t(`stationsDashboard.health.${st.controller.health}`)}</Pill>
                      : <Pill color="#6B7280">{t("stationsDashboard.manualOnly")}</Pill>}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 18, marginBottom: 10 }}>
                  <div><div className="kpi-label">{t("stationsDashboard.kpi.liters")}</div><div className="kpi-value" style={{ fontSize: 19 }}>{fmt0(st.liters)}</div></div>
                  <div><div className="kpi-label">{t("stationsDashboard.kpi.value")}</div><div className="kpi-value" style={{ fontSize: 19 }}>{fmt2(st.value)}</div></div>
                </div>
                {st.source !== "none" && <div className="note" style={{ marginTop: -6, marginBottom: 8, fontSize: 11.5 }}>{t(`stationsDashboard.source.${st.source}`)}</div>}
                {st.liters > 0 && (
                  <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", marginBottom: 10, background: "rgba(16,32,46,0.06)" }}>
                    {PRODUCTS.map((p) => st.products[p].liters > 0 && <div key={p} title={productLabel(p)} style={{ width: `${(st.products[p].liters / st.liters) * 100}%`, background: PRODUCT_COLOR[p] }} />)}
                  </div>
                )}
                {st.tanks.map((tank) => <TankBar key={tank.tankId} tank={tank} t={t} compact />)}
                {st.tanks.length === 0 && <div className="note" style={{ marginBottom: 6 }}>{t("stationsDashboard.noTanks")}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {(st.openShifts || []).map((sh) => (
                    <Pill key={sh.id} color="#1971c2">{sh.amount == null ? t("stationsDashboard.openShiftPill", { name: sh.employee || "—" }) : t("stationsDashboard.openShiftSalesPill", { name: sh.employee || "—", amount: fmt2(sh.amount) })}</Pill>
                  ))}
                  {st.today && <Pill color="#b8860b">{t("stationsDashboard.todayPill", { liters: fmt0(st.today.liters) })}</Pill>}
                  {st.awaitingReview > 0 && <Pill color="#B7791F">{t("stationsDashboard.reviewPill", { count: st.awaitingReview })}</Pill>}
                  {st.awaitingPost > 0 && <Pill color="#495057">{t("stationsDashboard.postPill", { count: st.awaitingPost })}</Pill>}
                  {st.lowTanks > 0 && <Pill color="#A8432B">{t("stationsDashboard.lowPill", { count: st.lowTanks })}</Pill>}
                  {st.alerts7d > 0 && <Pill color="#A8432B">{t("stationsDashboard.alertsPill", { count: st.alerts7d })}</Pill>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
