import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getInventoryMovementSummary } from "../../api/stockMovements";
import { listWarehouses } from "../../api/warehouses";
import { fmt } from "../../legacy/constants";
import { PrintShell } from "../../legacy/shared";
import DateRangeBar, { quickRange } from "../shared/DateRangeBar";
import { getItemDisplayName } from "../shared/itemDisplayName";

/**
 * حركة المخزون وتقييمه لأي فترة: رصيد أول/آخر المدة كمية وقيمة، الوارد والصادر، الدوران وأيام التغطية، وأيام الركود
 * منذ آخر صرف. بلا "من" = رصيد في تاريخ (منذ أول حركة). القيمة من الحركات نفسها (inventoryAnalysis.service.ts).
 */
const SLOW_DAYS = [30, 60, 90, 180];

export default function InventoryMovementTab({ companyId, company }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState(() => ({ ...quickRange("thisMonth"), warehouseId: "" }));
  const [warehouses, setWarehouses] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [slowDays, setSlowDays] = useState(90);
  const [onlySlow, setOnlySlow] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => { if (companyId) listWarehouses(companyId).then(setWarehouses).catch(() => {}); }, [companyId]);
  useEffect(() => {
    if (!companyId) return;
    setError("");
    getInventoryMovementSummary({ companyId, ...range }).then(setRows).catch((e) => setError(e.message));
  }, [companyId, range]);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;
  const isSlow = (r) => r.closingQty > 0.0001 && (r.daysSinceLastOut === null || r.daysSinceLastOut >= slowDays);
  const shown = (rows || []).filter((r) => !onlySlow || isSlow(r));
  const total = (k) => shown.reduce((s, r) => s + (r[k] || 0), 0);

  const table = <table className="ledger-table">
    <thead><tr>
      <th>{t("inventory.movement.item")}</th><th>{t("inventory.movement.opening")}</th><th>{t("inventory.movement.in")}</th><th>{t("inventory.movement.out")}</th>
      <th>{t("inventory.movement.closing")}</th><th>{t("inventory.movement.closingValue")}</th><th>{t("inventory.movement.turnover")}</th>
      <th>{t("inventory.movement.coverageDays")}</th><th>{t("inventory.movement.daysSinceLastOut")}</th>
    </tr></thead>
    <tbody>
      {shown.map((r) => (
        <tr key={r.itemId} className={isSlow(r) ? "row-warning" : ""}>
          <td>{r.itemCode} — {getItemDisplayName({ name: r.itemName, nameEn: r.itemNameEn }, i18n.language)} {isSlow(r) && <small className="balance-bad">● {t("inventory.movement.slow")}</small>}</td>
          <td className="num">{fmt(r.openingQty)}</td><td className="num">{fmt(r.inQty)}</td><td className="num">{fmt(r.outQty)}</td>
          <td className="num strong">{fmt(r.closingQty)} {r.unit || ""}</td>
          <td className="num">{r.valueTracked ? fmt(r.closingValue) : <span title={t("inventory.movement.periodicHint")}>—</span>}</td>
          <td className="num"><span dir="ltr">{r.turnover === null ? "—" : `${r.turnover.toFixed(2)}×`}</span></td>
          <td className="num">{r.coverageDays ?? "—"}</td>
          <td className="num">{r.daysSinceLastOut ?? t("inventory.movement.never")}</td>
        </tr>
      ))}
      {shown.length > 0 && <tr className="net-row"><td className="strong">{t("inventory.movement.total")}</td><td colSpan={4} /><td className="num strong">{fmt(total("closingValue"))}</td><td colSpan={3} /></tr>}
      {rows && shown.length === 0 && <tr><td className="empty" colSpan={9}>{t("inventory.movement.empty")}</td></tr>}
    </tbody>
  </table>;

  return <div className="panel">
    <h3>{t("nav.tabs.inventoryMovement")}</h3>
    <p style={{ fontSize: 12 }}>{t("inventory.movement.hint")}</p>
    <DateRangeBar value={range} onApply={setRange}>
      {(draft, setDraft) => <label>{t("inventory.movement.warehouse")}<select value={draft.warehouseId} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })}>
        <option value="">{t("inventory.movement.allWarehouses")}</option>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select></label>}
    </DateRangeBar>
    <div className="filter-bar">
      <label>{t("inventory.movement.slowThreshold")}<select value={slowDays} onChange={(e) => setSlowDays(Number(e.target.value))}>{SLOW_DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
      <label className="checkbox-label"><input type="checkbox" checked={onlySlow} onChange={(e) => setOnlySlow(e.target.checked)} />{t("inventory.movement.onlySlow")}</label>
      {rows && <button type="button" className="btn-secondary" onClick={() => setPrinting(true)}>{t("reports.printCurrent")}</button>}
    </div>
    {error && <p className="balance-bad">{error}</p>}
    {rows && table}
    {printing && <PrintShell company={company} subtitle={t("nav.tabs.inventoryMovement")} landscape refNode={<span dir="ltr">{range.from || "…"} — {range.to}</span>} onClose={() => setPrinting(false)}>{table}</PrintShell>}
  </div>;
}
