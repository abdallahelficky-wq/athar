import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPurchasesBySupplier, getPurchasesMonthly, getPurchasesVatSummary, getPayablesAging } from "../../api/purchaseReports";
import { fmt } from "../../legacy/constants";
import SubTabs from "../shared/SubTabs";

const TABS = [
  { id: "bySupplier", labelKey: "purchases.reports.tabs.bySupplier" },
  { id: "monthly", labelKey: "purchases.reports.tabs.monthly" },
  { id: "aging", labelKey: "purchases.reports.tabs.aging" },
  { id: "vat", labelKey: "purchases.reports.tabs.vat" },
];

export default function PurchaseReportsTab({ companyId }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("bySupplier");
  const [bySupplier, setBySupplier] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [aging, setAging] = useState([]);
  const [vat, setVat] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    getPurchasesBySupplier(companyId).then(setBySupplier);
    getPurchasesMonthly(companyId).then(setMonthly);
    getPayablesAging(companyId).then(setAging);
    getPurchasesVatSummary(companyId).then(setVat);
  }, [companyId]);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <SubTabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "bySupplier" && (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("purchases.reports.bySupplier.supplier")}</th><th>{t("purchases.reports.bySupplier.invoiceCount")}</th>
                <th>{t("purchases.reports.bySupplier.totalInvoices")}</th><th>{t("purchases.reports.bySupplier.totalReturns")}</th>
                <th>{t("purchases.reports.bySupplier.netPurchases")}</th>
              </tr>
            </thead>
            <tbody>
              {bySupplier.map((r) => (
                <tr key={r.supplierId}>
                  <td>{r.supplierName}</td><td className="num">{r.invoiceCount}</td>
                  <td className="num">{fmt(r.totalInvoices)}</td><td className="num">{fmt(r.totalReturns)}</td>
                  <td className="num strong">{fmt(r.netPurchases)}</td>
                </tr>
              ))}
              {bySupplier.length === 0 && <tr><td className="empty" colSpan={5}>{t("purchases.reports.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "monthly" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("purchases.reports.monthly.month")}</th><th>{t("purchases.reports.monthly.total")}</th></tr></thead>
            <tbody>
              {monthly.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{fmt(r.total)}</td></tr>)}
              {monthly.length === 0 && <tr><td className="empty" colSpan={2}>{t("purchases.reports.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "aging" && (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("purchases.reports.aging.supplier")}</th><th>{t("purchases.reports.aging.current")}</th>
                <th>{t("purchases.reports.aging.d30")}</th><th>{t("purchases.reports.aging.d60")}</th>
                <th>{t("purchases.reports.aging.d90")}</th><th>{t("purchases.reports.aging.total")}</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((r) => (
                <tr key={r.supplierId}>
                  <td>{r.supplierName}</td><td className="num">{fmt(r.current)}</td><td className="num">{fmt(r.d30)}</td>
                  <td className="num">{fmt(r.d60)}</td><td className="num">{fmt(r.d90)}</td><td className="num strong">{fmt(r.total)}</td>
                </tr>
              ))}
              {aging.length === 0 && <tr><td className="empty" colSpan={6}>{t("purchases.reports.aging.empty")}</td></tr>}
            </tbody>
          </table>
          <p className="note">{t("purchases.reports.agingNote")}</p>
        </div>
      )}

      {tab === "vat" && vat && (
        <div className="panel">
          <table className="ledger-table">
            <tbody>
              <tr><td>{t("purchases.reports.vat.purchasesBase")}</td><td className="num">{fmt(vat.purchasesBase)}</td></tr>
              <tr><td>{t("purchases.reports.vat.inputVat")}</td><td className="num">{fmt(vat.inputVat)}</td></tr>
              <tr><td>{t("purchases.reports.vat.returnsBase")}</td><td className="num">{fmt(vat.returnsBase)}</td></tr>
              <tr><td>{t("purchases.reports.vat.returnsVat")}</td><td className="num">{fmt(vat.returnsVat)}</td></tr>
              <tr className="net-row"><td className="strong">{t("purchases.reports.vat.netInputVat")}</td><td className="num strong">{fmt(vat.netInputVat)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
