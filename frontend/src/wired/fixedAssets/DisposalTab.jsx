import React, { useEffect, useState } from "react";
import { listFixedAssets, disposeFixedAsset } from "../../api/fixedAssets";
import { fmt } from "../../legacy/constants";

export default function DisposalTab({ companyId }) {
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

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div className="panel form-panel">
      <div className="form-grid">
        <label>الأصل<select value={assetId} onChange={(e) => { setAssetId(e.target.value); setResult(null); }}>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>تاريخ الاستبعاد<input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} /></label>
        <label>سعر البيع (صفر إن كان إتلافاً)<input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></label>
        <label>طريقة الاستلام<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">نقدي</option><option value="bank">بنكي</option></select></label>
      </div>
      {asset && (
        <div className="preview-box">
          <div className="preview-row"><span>مجمع الإهلاك حتى تاريخ الاستبعاد</span><strong>{fmt(asset.accumulatedDepreciation)} ر.س</strong></div>
          <div className="preview-row"><span>صافي القيمة الدفترية</span><strong>{fmt(asset.netBookValue)} ر.س</strong></div>
        </div>
      )}
      {result && (
        <div className="preview-box">
          <div className="preview-row net-row"><span>{result.gainLoss >= 0 ? "ربح الاستبعاد" : "خسارة الاستبعاد"}</span><strong>{fmt(Math.abs(result.gainLoss))} ر.س</strong></div>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
      <button className="btn-primary" onClick={dispose} disabled={!asset}>ترحيل الاستبعاد</button>
      {assets.length === 0 && <p className="empty">لا توجد أصول نشطة لاستبعادها.</p>}
    </div>
  );
}
