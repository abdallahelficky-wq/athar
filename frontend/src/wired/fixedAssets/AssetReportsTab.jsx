import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFixedAssetsSummary } from "../../api/fixedAssets";
import { fmt } from "../../legacy/constants";

export default function AssetReportsTab({ companyId }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    getFixedAssetsSummary(companyId).then(setSummary);
  }, [companyId]);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;
  if (!summary) return <p className="empty">{t("common.loading")}</p>;

  return (
    <div className="panel">
      <table className="ledger-table">
        <tbody>
          <tr><td>{t("fixedAssets.reports.activeCount")}</td><td className="num">{summary.activeCount}</td></tr>
          <tr><td>{t("fixedAssets.reports.disposedCount")}</td><td className="num">{summary.disposedCount}</td></tr>
          <tr><td>{t("fixedAssets.reports.totalCost")}</td><td className="num">{fmt(summary.totalCost)}</td></tr>
          <tr className="net-row"><td className="strong">{t("fixedAssets.reports.totalNetBookValue")}</td><td className="num strong">{fmt(summary.totalNetBookValue)}</td></tr>
        </tbody>
      </table>
      <h3 className="sub-head">{t("fixedAssets.reports.byCategory")}</h3>
      <table className="ledger-table">
        <thead><tr><th>{t("fixedAssets.reports.table.category")}</th><th>{t("fixedAssets.reports.table.count")}</th><th>{t("fixedAssets.reports.table.totalCost")}</th></tr></thead>
        <tbody>
          {summary.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{c.count}</td><td className="num">{fmt(c.cost)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
