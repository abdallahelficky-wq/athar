import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listFixedAssets, disposeFixedAsset } from "../../api/fixedAssets";
import { fmt } from "../../legacy/constants";
import { currencyLabel } from "../../shared/countries";

export default function DisposalTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [assets, setAssets] = useState([]);
  const [assetId, setAssetId] = useState("");
  const [disposalDate, setDisposalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salePrice, setSalePrice] = useState("0");
  const [method, setMethod] = useState("cash");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const reload = () => {
    if (!companyId) return;
    listFixedAssets(companyId).then((all) => {
      const active = all.filter((a) => a.status !== "disposed");
      setAssets(active);
      if (active[0]) setAssetId((v) => v || active[0].id);
    });
  };
  useEffect(reload, [companyId]);

  const asset = assets.find((a) => a.id === assetId);

  const dispose = async () => {
    if (!asset) return;
    try {
      const r = await disposeFixedAsset(asset.id, { disposalDate, salePrice: Number(salePrice || 0), method });
      setResult(r);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div className="panel form-panel">
      <div className="form-grid">
        <label>{t("fixedAssets.disposal.asset")}<select value={assetId} onChange={(e) => { setAssetId(e.target.value); setResult(null); }}>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>{t("fixedAssets.disposal.disposalDate")}<input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} /></label>
        <label>{t("fixedAssets.disposal.salePrice")}<input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></label>
        <label>{t("fixedAssets.disposal.receiveMethod")}<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">{t("fixedAssets.disposal.methodCash")}</option><option value="bank">{t("fixedAssets.disposal.methodBank")}</option></select></label>
      </div>
      {asset && (
        <div className="preview-box">
          <div className="preview-row"><span>{t("fixedAssets.disposal.accumulatedDepreciation")}</span><strong>{fmt(asset.accumulatedDepreciation)} {currency}</strong></div>
          <div className="preview-row"><span>{t("fixedAssets.disposal.netBookValue")}</span><strong>{fmt(asset.netBookValue)} {currency}</strong></div>
        </div>
      )}
      {result && (
        <div className="preview-box">
          <div className="preview-row net-row"><span>{result.gainLoss >= 0 ? t("fixedAssets.disposal.gain") : t("fixedAssets.disposal.loss")}</span><strong>{fmt(Math.abs(result.gainLoss))} {currency}</strong></div>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
      <button className="btn-primary" onClick={dispose} disabled={!asset}>{t("fixedAssets.disposal.postBtn")}</button>
      {assets.length === 0 && <p className="empty">{t("fixedAssets.disposal.empty")}</p>}
    </div>
  );
}
