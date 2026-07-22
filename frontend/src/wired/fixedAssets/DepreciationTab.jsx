import React, { useEffect, useState } from "react";
import { previewDepreciation, postDepreciationRun } from "../../api/depreciation";
import { fmt } from "../../legacy/constants";

export default function DepreciationTab({ companyId }) {
  const [month, setMonth] = useState("2026-07");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const reload = () => {
    if (!companyId) return;
    previewDepreciation(companyId, month).then(setPreview).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId, month]);

  const post = async () => {
    try {
      await postDepreciationRun(companyId, month);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid"><label>الشهر<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label></div>
        {preview?.alreadyPosted && <p className="note">تم ترحيل إهلاك هذا الشهر مسبقاً بمبلغ {fmt(preview.existingRun.totalAmount)} ر.س.</p>}
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={post} disabled={!preview || preview.alreadyPosted || preview.total <= 0}>ترحيل إهلاك الشهر</button>
      </div>

      {preview && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الأصل</th><th>التكلفة</th><th>العمر الإنتاجي</th><th>الإهلاك الشهري</th></tr></thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.assetId}><td>{r.name}</td><td className="num">{fmt(r.cost)}</td><td className="num">{r.usefulLifeYears} سنة</td><td className="num">{fmt(r.monthly)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt(preview.total)}</td></tr></tfoot>
          </table>
          {preview.rows.length === 0 && <p className="empty">لا توجد أصول نشطة لحساب إهلاكها.</p>}
        </div>
      )}
    </div>
  );
}
