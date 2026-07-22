import React, { useEffect, useState } from "react";
import { getExpiringDocuments } from "../../api/hrReports";
import { EMPLOYEE_DOC_TYPES } from "../../legacy/hr";

export default function HRReportsTab({ companyId }) {
  const [withinDays, setWithinDays] = useState(30);
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const load = async () => {
    if (!companyId) return;
    try {
      const data = await getExpiringDocuments(companyId, withinDays);
      setRows(data.filter((r) => !docTypeFilter || r.doc.type === docTypeFilter));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>خلال كم يوم<input type="number" value={withinDays} onChange={(e) => setWithinDays(Number(e.target.value) || 0)} /></label>
          <label>نوع المستند<select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}><option value="">كل الأنواع</option>{EMPLOYEE_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={load}>إصدار التقرير</button>
      </div>

      <div className="panel">
        <h3 className="sub-head">الموظفون بمستندات تنتهي خلال {withinDays} يوم</h3>
        <table className="ledger-table">
          <thead><tr><th>الموظف</th><th>نوع المستند</th><th>الرقم</th><th>تاريخ الانتهاء</th><th>الأيام المتبقية</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.employeeName}</td>
                <td>{r.doc.type}</td><td>{r.doc.number || "—"}</td><td>{r.doc.expiryDate.slice(0, 10)}</td>
                <td className={r.days < 0 ? "balance-bad" : "doc-warning-text"}>{r.days < 0 ? `منتهٍ منذ ${Math.abs(r.days)} يوم` : `${r.days} يوم`}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد مستندات ضمن هذا النطاق.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
