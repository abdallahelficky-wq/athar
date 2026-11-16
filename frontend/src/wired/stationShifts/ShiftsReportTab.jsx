import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../i18n/dateFormat";
import * as api from "../../api/shiftsReport";
import { listStations } from "../../api/stationSetup";

const PRODUCTS = ["gasoline_91", "gasoline_95", "diesel"];
const isoDay = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
const money = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const lit = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const time = (v) => (v ? new Date(v).toLocaleTimeString("en-GB", { calendar: "gregory", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * تقرير الورديات: لكل يوم ومحطة صف للوردية الصباحية وصف للمسائية وصف لإجمالي اليوم — لترات ومبلغ كل منتج، والتحصيل
 * (شبكة، بطاقات، نقد، آجل، مصروفات) والفرق (التحصيل − المبيعات: موجب زيادة، سالب عجز)، ثم إجمالي الفترة بالصباحي والمسائي.
 * الوردية الآلية التي لم يرفع الجهاز كل عملياتها حتى إقفالها تُعلَّم "بيانات الجهاز ناقصة" — أرقامها قد تتغير.
 */
export default function ShiftsReportTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [stations, setStations] = useState([]);
  const [filter, setFilter] = useState({ dateFrom: daysAgo(6), dateTo: isoDay(new Date()), costCenterId: "" });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (f = filter) => {
    setError(""); setLoading(true);
    try {
      setReport(await api.getShiftsDailyReport({ companyId, ...f }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    listStations(companyId).then((st) => setStations(st.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
    load();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // المنتجات الظاهرة: ما بيع منه شيء في الفترة (مكة: 91 و95 فقط — لا عمود ديزل فارغ)
  const products = useMemo(() => {
    if (!report) return [];
    const used = PRODUCTS.filter((p) => report.totals.products[p].liters > 0
      || report.rows.some((r) => [...r.morning, ...r.night].some((c) => c.products?.[p])));
    return used.length ? used : ["gasoline_91", "gasoline_95"];
  }, [report]);

  const statusBadge = (cell) => {
    const parts = [t(`shiftsReport.statuses.${cell.status}`)];
    if (cell.deviceDataComplete === false) parts.push(t("shiftsReport.deviceIncomplete"));
    if (!cell.complete) parts.push(t("shiftsReport.readingsIncomplete"));
    return parts.join(" · ");
  };

  const valueCells = (v, isTotals) => (
    <>
      {products.map((p) => {
        const pv = v?.products?.[p];
        return (
          <React.Fragment key={p}>
            <td className="num">{pv ? lit(pv.liters) : (isTotals ? lit(0) : "—")}</td>
            <td className="num">{pv ? money(pv.amount) : (isTotals ? money(0) : "—")}</td>
          </React.Fragment>
        );
      })}
      <td className="num strong">{lit(v?.liters)}</td>
      <td className="num strong">{money(v?.amount)}</td>
      <td className="num">{money(v?.network)}</td>
      <td className="num">{money(v?.fuelCard)}</td>
      <td className="num">{money(v?.cash)}</td>
      <td className="num">{money(v?.credit)}</td>
      <td className="num">{money(v?.expenses)}</td>
      <td className="num strong">{money(v?.collected)}</td>
      <td className={`num strong ${v?.variance == null ? "" : Number(v.variance) < 0 ? "balance-bad" : "balance-ok"}`}>{money(v?.variance)}</td>
    </>
  );

  const shiftRows = (row, type) => (row[type].length ? row[type] : [null]).map((c, i) => (
    <tr key={c?.id ?? `${type}-${i}`}>
        <td>{t(`shiftsReport.${type}`)}</td>
        <td style={{ fontSize: 12 }}>
          {c ? (
            <>
              <div>{c.worker || "—"}{c.openedAt ? ` · ${time(c.openedAt)}–${c.closedAt ? time(c.closedAt) : "…"}` : ""}</div>
              <div className={c.deviceDataComplete === false || !c.complete ? "balance-bad" : "note"} style={{ margin: 0 }}>{statusBadge(c)}</div>
            </>
          ) : t("shiftsReport.noShift")}
        </td>
        {c ? valueCells(c, false) : <td colSpan={products.length * 2 + 9} className="note">—</td>}
    </tr>
  ));

  const totalsRow = (label, v, key, strong) => (
    <tr key={key} style={{ background: strong ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.03)", fontWeight: 700 }}>
      <td>{label}</td>
      <td style={{ fontSize: 12 }}>{t("shiftsReport.shiftsCount", { count: v.shifts })}{v.incompleteShifts ? ` · ${t("shiftsReport.incompleteCount", { count: v.incompleteShifts })}` : ""}</td>
      {valueCells(v, true)}
    </tr>
  );

  const stationLabel = filter.costCenterId ? stations.find((s) => s.id === filter.costCenterId)?.name : t("shiftsReport.allStations");

  return (
    <div className="shifts-report">
      <div className="form-grid no-print" style={{ alignItems: "end" }}>
        <label>{t("shiftsReport.from")}
          <input type="date" value={filter.dateFrom} onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value })} />
        </label>
        <label>{t("shiftsReport.to")}
          <input type="date" value={filter.dateTo} onChange={(e) => setFilter({ ...filter, dateTo: e.target.value })} />
        </label>
        <label>{t("shiftsReport.station")}
          <select value={filter.costCenterId} onChange={(e) => setFilter({ ...filter, costCenterId: e.target.value })}>
            <option value="">{t("shiftsReport.allStations")}</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" onClick={() => load()} disabled={loading}>{t("shiftsReport.show")}</button>
          <button className="btn-ghost" onClick={() => window.print()} disabled={!report}>{t("shiftsReport.print")}</button>
        </div>
      </div>
      {error && <p className="balance-bad" role="alert">{error}</p>}
      {loading && <p className="note">…</p>}

      {report && !loading && (
        <div className="panel">
          <h3 style={{ marginBottom: 4 }}>{t("shiftsReport.title")}</h3>
          <p className="note" style={{ marginTop: 0 }}>
            {stationLabel} · {formatDate(report.dateFrom, i18n.language)} — {formatDate(report.dateTo, i18n.language)}
          </p>
          <p className="note no-print">{t("shiftsReport.note")}</p>

          {report.rows.length === 0 ? <p className="note">{t("shiftsReport.empty")}</p> : (
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th rowSpan={2}>{t("shiftsReport.shift")}</th>
                    <th rowSpan={2}>{t("shiftsReport.details")}</th>
                    {products.map((p) => <th key={p} colSpan={2}>{t(`stationSetup.products.${p}`)}</th>)}
                    <th colSpan={2}>{t("shiftsReport.totalSales")}</th>
                    <th colSpan={6}>{t("shiftsReport.collection")}</th>
                    <th rowSpan={2}>{t("shiftsReport.variance")}</th>
                  </tr>
                  <tr>
                    {products.map((p) => (
                      <React.Fragment key={p}><th>{t("shiftsReport.liters")}</th><th>{t("shiftsReport.amount")}</th></React.Fragment>
                    ))}
                    <th>{t("shiftsReport.liters")}</th><th>{t("shiftsReport.amount")}</th>
                    <th>{t("shiftsReport.network")}</th><th>{t("shiftsReport.fuelCard")}</th><th>{t("shiftsReport.cash")}</th>
                    <th>{t("shiftsReport.credit")}</th><th>{t("shiftsReport.expenses")}</th><th>{t("shiftsReport.collected")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <React.Fragment key={`${row.day}|${row.costCenterId}`}>
                      <tr>
                        <td colSpan={products.length * 2 + 11} style={{ background: "rgba(0,0,0,0.08)", fontWeight: 700 }}>
                          {formatDate(row.day, i18n.language)} · {row.stationName}
                        </td>
                      </tr>
                      {shiftRows(row, "morning")}
                      {shiftRows(row, "night")}
                      {totalsRow(t("shiftsReport.dayTotal"), row.total, "total")}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={products.length * 2 + 11} style={{ fontWeight: 700, paddingTop: 12 }}>{t("shiftsReport.periodTotals")}</td></tr>
                  {totalsRow(t("shiftsReport.morningTotal"), report.byType.morning, "pm")}
                  {totalsRow(t("shiftsReport.nightTotal"), report.byType.night, "pn")}
                  {totalsRow(t("shiftsReport.periodTotal"), report.totals, "pt", true)}
                </tfoot>
              </table>
            </div>
          )}
          <p className="note" style={{ fontSize: 12 }}>{t("shiftsReport.varianceNote")}</p>
        </div>
      )}
    </div>
  );
}
