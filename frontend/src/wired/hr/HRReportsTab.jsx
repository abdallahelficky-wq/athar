import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getExpiringDocuments } from "../../api/hrReports";
import { EMPLOYEE_DOC_TYPES } from "../../legacy/hr";

export default function HRReportsTab({ companyId }) {
  const { t } = useTranslation();
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

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("hr.reports.withinDays")}<input type="number" value={withinDays} onChange={(e) => setWithinDays(Number(e.target.value) || 0)} /></label>
          <label>{t("hr.reports.docType")}<select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}><option value="">{t("hr.reports.allTypes")}</option>{EMPLOYEE_DOC_TYPES.map((t2) => <option key={t2}>{t2}</option>)}</select></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={load}>{t("hr.reports.generateBtn")}</button>
      </div>

      <div className="panel">
        <h3 className="sub-head">{t("hr.reports.title", { days: withinDays })}</h3>
        <table className="ledger-table">
          <thead><tr><th>{t("hr.reports.table.employee")}</th><th>{t("hr.reports.table.docType")}</th><th>{t("hr.reports.table.number")}</th><th>{t("hr.reports.table.expiry")}</th><th>{t("hr.reports.table.daysLeft")}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.employeeName}</td>
                <td>{r.doc.type}</td><td>{r.doc.number || "—"}</td><td>{r.doc.expiryDate.slice(0, 10)}</td>
                <td className={r.days < 0 ? "balance-bad" : "doc-warning-text"}>{r.days < 0 ? t("hr.reports.expiredSince", { days: Math.abs(r.days) }) : t("hr.reports.daysLeftValue", { days: r.days })}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="empty" colSpan={5}>{t("hr.reports.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
