import React, { useEffect, useState } from "react";
import { getFixedAssetsSummary } from "../../api/fixedAssets";
import { fmt } from "../../legacy/constants";

export default function AssetReportsTab({ companyId }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    getFixedAssetsSummary(companyId).then(setSummary);
  }, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;
  if (!summary) return <p className="empty">جارٍ التحميل...</p>;

  return (
    <div className="panel">
      <table className="ledger-table">
        <tbody>
          <tr><td>عدد الأصول النشطة</td><td className="num">{summary.activeCount}</td></tr>
          <tr><td>عدد الأصول المستبعدة</td><td className="num">{summary.disposedCount}</td></tr>
          <tr><td>إجمالي التكلفة</td><td className="num">{fmt(summary.totalCost)}</td></tr>
          <tr className="net-row"><td className="strong">إجمالي صافي القيمة الدفترية للأصول النشطة</td><td className="num strong">{fmt(summary.totalNetBookValue)}</td></tr>
        </tbody>
      </table>
      <h3 className="sub-head">حسب التصنيف</h3>
      <table className="ledger-table">
        <thead><tr><th>التصنيف</th><th>العدد</th><th>إجمالي التكلفة</th></tr></thead>
        <tbody>
          {summary.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{c.count}</td><td className="num">{fmt(c.cost)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
