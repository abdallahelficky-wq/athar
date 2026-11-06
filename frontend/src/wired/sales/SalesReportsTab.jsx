import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSalesByCustomer, getSalesMonthly, getSalesVatSummary, getReceivablesAging, getSalesByItem, getSalesByBranch } from "../../api/salesReports";
import DateRangeBar, { quickRange } from "../shared/DateRangeBar";
import { getItemDisplayName } from "../shared/itemDisplayName";
import { fmt } from "../../legacy/constants";
import SubTabs from "../shared/SubTabs";
import VatPeriodBar from "../shared/VatPeriodBar";
import { useVatFetch, useVatPeriod } from "../shared/vatPeriod";

const TABS = [
  { id: "byCustomer", labelKey: "sales.reports.tabs.byCustomer" },
  { id: "byItem", labelKey: "sales.reports.tabs.byItem" },
  { id: "byBranch", labelKey: "sales.reports.tabs.byBranch" },
  { id: "monthly", labelKey: "sales.reports.tabs.monthly" },
  { id: "aging", labelKey: "sales.reports.tabs.aging" },
  { id: "vat", labelKey: "sales.reports.tabs.vat" },
];

export default function SalesReportsTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  // فترة مشتركة لتقارير حسب العميل/الصنف/الفرع والاتجاه الشهري — الافتراضي هذه السنة
  const [range, setRange] = useState(() => quickRange("thisYear"));
  const [byItem, setByItem] = useState([]);
  const [byBranch, setByBranch] = useState([]);
  const [tab, setTab] = useState("byCustomer");
  const [byCustomer, setByCustomer] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [aging, setAging] = useState([]);
  // المركز كما في تاريخ — فارغ = اليوم
  const [agingAsOf, setAgingAsOf] = useState("");
  const vatPeriod = useVatPeriod(companies?.find((c) => c.id === companyId));
  const { data: vat, error: vatError } = useVatFetch(getSalesVatSummary, companyId, vatPeriod.applied);

  useEffect(() => {
    if (!companyId) return;
    getSalesByCustomer(companyId, range).then(setByCustomer);
    getSalesMonthly(companyId, range).then(setMonthly);
    getSalesByItem(companyId, range).then(setByItem);
    getSalesByBranch(companyId, range).then(setByBranch);
  }, [companyId, range]);

  useEffect(() => {
    if (!companyId) return;
    getReceivablesAging(companyId, agingAsOf).then(setAging);
  }, [companyId, agingAsOf]);


  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <SubTabs tabs={TABS} active={tab} onChange={setTab} />
      {["byCustomer", "byItem", "byBranch", "monthly"].includes(tab) && <div className="panel"><DateRangeBar value={range} onApply={setRange} /></div>}

      {tab === "byItem" && (
        <div className="panel">
          <p style={{ fontSize: 12 }}>{t("sales.reports.byItem.note")}</p>
          <table className="ledger-table">
            <thead><tr>
              <th>{t("sales.reports.byItem.item")}</th><th>{t("sales.reports.byItem.quantity")}</th><th>{t("sales.reports.byItem.returnQuantity")}</th>
              <th>{t("sales.reports.byItem.netSales")}</th><th>{t("sales.reports.byItem.cost")}</th><th>{t("sales.reports.byItem.grossProfit")}</th><th>{t("sales.reports.byItem.margin")}</th>
            </tr></thead>
            <tbody>
              {byItem.map((r) => (
                <tr key={r.itemId || "none"}>
                  <td>{r.itemId ? `${r.itemCode} — ${getItemDisplayName({ name: r.itemName, nameEn: r.itemNameEn }, i18n.language)}` : t("sales.reports.byItem.noItem")}</td>
                  <td className="num">{fmt(r.quantity)} {r.unit}</td><td className="num">{fmt(r.returnQuantity)}</td>
                  <td className="num strong">{fmt(r.netSales)}</td><td className="num">{fmt(r.cost)}</td>
                  <td className={"num strong " + (r.grossProfit < 0 ? "balance-bad" : "")}>{fmt(r.grossProfit)}</td>
                  <td className="num"><span dir="ltr">{r.margin === null ? "—" : `${(r.margin * 100).toFixed(1)}%`}</span></td>
                </tr>
              ))}
              {byItem.length > 0 && (() => {
                const sum = (k) => byItem.reduce((x, r) => x + r[k], 0);
                const net = sum("netSales"); const gp = sum("grossProfit");
                return <tr className="net-row"><td className="strong">{t("sales.reports.byItem.total")}</td><td /><td /><td className="num strong">{fmt(net)}</td><td className="num strong">{fmt(sum("cost"))}</td><td className="num strong">{fmt(gp)}</td><td className="num"><span dir="ltr">{net ? `${((gp / net) * 100).toFixed(1)}%` : "—"}</span></td></tr>;
              })()}
              {byItem.length === 0 && <tr><td className="empty" colSpan={7}>{t("sales.reports.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "byBranch" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("sales.reports.byBranch.branch")}</th><th>{t("sales.reports.byCustomer.invoiceCount")}</th><th>{t("sales.reports.byBranch.sales")}</th><th>{t("sales.reports.byBranch.returns")}</th><th>{t("sales.reports.byBranch.netSales")}</th><th>{t("sales.reports.byBranch.vat")}</th></tr></thead>
            <tbody>
              {byBranch.map((r) => (
                <tr key={r.branchId || "none"}>
                  <td>{r.branchId ? (i18n.language.startsWith("en") && r.branchNameEn ? r.branchNameEn : r.branchName) : t("sales.reports.byBranch.noBranch")}</td>
                  <td className="num">{r.invoiceCount}</td><td className="num">{fmt(r.sales)}</td><td className="num">{fmt(r.returns)}</td><td className="num strong">{fmt(r.netSales)}</td><td className="num">{fmt(r.vat)}</td>
                </tr>
              ))}
              {byBranch.length === 0 && <tr><td className="empty" colSpan={6}>{t("sales.reports.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "byCustomer" && (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.reports.byCustomer.customer")}</th><th>{t("sales.reports.byCustomer.invoiceCount")}</th>
                <th>{t("sales.reports.byCustomer.totalInvoices")}</th><th>{t("sales.reports.byCustomer.totalReturns")}</th>
                <th>{t("sales.reports.byCustomer.netSales")}</th><th>{t("sales.reports.byCustomer.outstanding")}</th>
              </tr>
            </thead>
            <tbody>
              {byCustomer.map((r) => (
                <tr key={r.customerId}>
                  <td>{r.customerName}</td><td className="num">{r.invoiceCount}</td>
                  <td className="num">{fmt(r.totalInvoices)}</td><td className="num">{fmt(r.totalReturns)}</td>
                  <td className="num strong">{fmt(r.netSales)}</td><td className="num">{fmt(r.outstanding)}</td>
                </tr>
              ))}
              {byCustomer.length === 0 && <tr><td className="empty" colSpan={6}>{t("sales.reports.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "monthly" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("sales.reports.monthly.month")}</th><th>{t("sales.reports.monthly.total")}</th></tr></thead>
            <tbody>
              {monthly.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{fmt(r.total)}</td></tr>)}
              {monthly.length === 0 && <tr><td className="empty" colSpan={2}>{t("sales.reports.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "aging" && (
        <div className="panel">
          <label className="aging-asof">{t("sales.reports.aging.asOf")} <input type="date" value={agingAsOf} onChange={(e) => setAgingAsOf(e.target.value)} /></label>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.reports.aging.customer")}</th><th>{t("sales.reports.aging.current")}</th>
                <th>{t("sales.reports.aging.d30")}</th><th>{t("sales.reports.aging.d60")}</th>
                <th>{t("sales.reports.aging.d90")}</th><th title={t("sales.reports.aging.unallocatedHint")}>{t("sales.reports.aging.unallocated")}</th><th>{t("sales.reports.aging.total")}</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((r) => (
                <tr key={r.customerId}>
                  <td>{r.customerName}</td><td className="num">{fmt(r.current)}</td><td className="num">{fmt(r.d30)}</td>
                  <td className="num">{fmt(r.d60)}</td><td className="num">{fmt(r.d90)}</td><td className="num">{fmt(r.unallocated)}</td><td className="num strong">{fmt(r.total)}</td>
                </tr>
              ))}
              {aging.length === 0 && <tr><td className="empty" colSpan={7}>{t("sales.reports.aging.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "vat" && (
        <div className="panel">
          <VatPeriodBar title={t("sales.reports.tabs.vat")} period={vatPeriod} />
          {vatError && <p className="balance-bad">{vatError}</p>}
          {vat && (
            <table className="ledger-table">
              <tbody>
                <tr><td>{t("sales.reports.vat.salesBase")} ({vat.invoiceCount})</td><td className="num">{fmt(vat.salesBase)}</td></tr>
                <tr><td>{t("sales.reports.vat.outputVat")}</td><td className="num">{fmt(vat.outputVat)}</td></tr>
                <tr><td>{t("sales.reports.vat.debitNotesBase")} ({vat.debitNoteCount})</td><td className="num">{fmt(vat.debitNotesBase)}</td></tr>
                <tr><td>{t("sales.reports.vat.debitNotesVat")}</td><td className="num">{fmt(vat.debitNotesVat)}</td></tr>
                <tr><td>{t("sales.reports.vat.returnsBase")} ({vat.returnCount})</td><td className="num">{fmt(vat.returnsBase)}</td></tr>
                <tr><td>{t("sales.reports.vat.returnsVat")}</td><td className="num">{fmt(vat.returnsVat)}</td></tr>
                <tr className="net-row"><td className="strong">{t("sales.reports.vat.netOutputVat")}</td><td className="num strong">{fmt(vat.netOutputVat)}</td></tr>
                <tr><td>{t("sales.reports.vat.stationShiftVat")} ({vat.stationShiftCount})<div className="vat-note">{t("sales.reports.vat.stationShiftNote")}</div></td><td className="num">{fmt(vat.stationShiftVat)}</td></tr>
                <tr className="net-row"><td className="strong">{t("sales.reports.vat.totalWithStations")}</td><td className="num strong">{fmt(vat.totalOutputVatWithStations)}</td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
