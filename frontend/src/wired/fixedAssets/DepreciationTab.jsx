import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { previewDepreciation, postDepreciationRun } from "../../api/depreciation";
import { fmt } from "../../legacy/constants";
import { useDeferredFilters } from "../shared/useDeferredFilters";
import { currencyLabel } from "../../shared/countries";

export default function DepreciationTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const mf = useDeferredFilters({ month: "2026-07" });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const reload = () => {
    if (!companyId) return;
    previewDepreciation(companyId, mf.applied.month).then(setPreview).catch((e) => setError(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [companyId, mf.applied]);

  const post = async () => {
    try {
      await postDepreciationRun(companyId, mf.applied.month);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mf.apply(); }}>
          <label>{t("fixedAssets.depreciation.month")}<input type="month" value={mf.draft.month} onChange={(e) => mf.setField("month", e.target.value)} /></label>
          <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("fixedAssets.depreciation.showResults")}</button>
        </form>
        {preview?.alreadyPosted && <p className="note">{t("fixedAssets.depreciation.alreadyPosted", { amount: fmt(preview.existingRun.totalAmount), currency })}</p>}
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={post} disabled={!preview || preview.alreadyPosted || preview.total <= 0}>{t("fixedAssets.depreciation.postBtn")}</button>
      </div>

      {preview && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("fixedAssets.depreciation.table.asset")}</th><th>{t("fixedAssets.depreciation.table.cost")}</th><th>{t("fixedAssets.depreciation.table.usefulLife")}</th><th>{t("fixedAssets.depreciation.table.monthlyDepreciation")}</th></tr></thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.assetId}><td>{r.name}</td><td className="num">{fmt(r.cost)}</td><td className="num">{r.usefulLifeYears} {t("fixedAssets.depreciation.years")}</td><td className="num">{fmt(r.monthly)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td className="foot-label" colSpan={3}>{t("fixedAssets.depreciation.total")}</td><td className="num strong">{fmt(preview.total)}</td></tr></tfoot>
          </table>
          {preview.rows.length === 0 && <p className="empty">{t("fixedAssets.depreciation.empty")}</p>}
        </div>
      )}
    </div>
  );
}
