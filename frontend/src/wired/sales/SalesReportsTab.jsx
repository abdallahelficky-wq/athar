import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSalesByCustomer, getSalesMonthly, getSalesVatSummary, getReceivablesAging } from "../../api/salesReports";
import { fmt } from "../../legacy/constants";
import SubTabs from "../shared/SubTabs";

const TABS = [
  { id: "byCustomer", labelKey: "sales.reports.tabs.byCustomer" },
  { id: "monthly", labelKey: "sales.reports.tabs.monthly" },
  { id: "aging", labelKey: "sales.reports.tabs.aging" },
  { id: "vat", labelKey: "sales.reports.tabs.vat" },
];

export default function SalesReportsTab({ companyId }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("byCustomer");
  const [byCustomer, setByCustomer] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [aging, setAging] = useState([]);
  const [vat, setVat] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    getSalesByCustomer(companyId).then(setByCustomer);
    getSalesMonthly(companyId).then(setMonthly);
    getReceivablesAging(companyId).then(setAging);
    getSalesVatSummary(companyId).then(setVat);
  }, [companyId]);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <SubTabs tabs={TABS} active={tab} onChange={setTab} />

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
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.reports.aging.customer")}</th><th>{t("sales.reports.aging.current")}</th>
                <th>{t("sales.reports.aging.d30")}</th><th>{t("sales.reports.aging.d60")}</th>
                <th>{t("sales.reports.aging.d90")}</th><th>{t("sales.reports.aging.total")}</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((r) => (
                <tr key={r.customerId}>
                  <td>{r.customerName}</td><td className="num">{fmt(r.current)}</td><td className="num">{fmt(r.d30)}</td>
                  <td className="num">{fmt(r.d60)}</td><td className="num">{fmt(r.d90)}</td><td className="num strong">{fmt(r.total)}</td>
                </tr>
              ))}
              {aging.length === 0 && <tr><td className="empty" colSpan={6}>{t("sales.reports.aging.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "vat" && vat && (
        <div className="panel">
          <table className="ledger-table">
            <tbody>
              <tr><td>{t("sales.reports.vat.salesBase")}</td><td className="num">{fmt(vat.salesBase)}</td></tr>
              <tr><td>{t("sales.reports.vat.outputVat")}</td><td className="num">{fmt(vat.outputVat)}</td></tr>
              <tr><td>{t("sales.reports.vat.returnsBase")}</td><td className="num">{fmt(vat.returnsBase)}</td></tr>
              <tr><td>{t("sales.reports.vat.returnsVat")}</td><td className="num">{fmt(vat.returnsVat)}</td></tr>
              <tr className="net-row"><td className="strong">{t("sales.reports.vat.netOutputVat")}</td><td className="num strong">{fmt(vat.netOutputVat)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
