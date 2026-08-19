import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployees, getEmployeeEos } from "../../api/employees";
import { fmt } from "../../legacy/constants";

export default function EndOfServiceTab({ companyId }) {
  const { t } = useTranslation();
  const REASONS = [
    { id: "resign", label: t("hr.eos.reasons.resign") },
    { id: "employer", label: t("hr.eos.reasons.employer") },
    { id: "contractEnd", label: t("hr.eos.reasons.contractEnd") },
  ];
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("resign");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then((es) => { setEmployees(es); if (es[0]) setEmployeeId((v) => v || es[0].id); });
  }, [companyId]);

  const calculate = async () => {
    if (!employeeId) return;
    setError("");
    setResult(null);
    try {
      const data = await getEmployeeEos(employeeId, endDate, reason);
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("hr.eos.employee")}<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>{t("hr.eos.endDate")}<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label>{t("hr.eos.reason")}<select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={calculate} disabled={!employeeId}>{t("hr.eos.calculateBtn")}</button>
      </div>

      {result && (
        <div className="panel">
          <h3 className="sub-head">{t("hr.eos.resultTitle")}</h3>
          <table className="ledger-table">
            <tbody>
              <tr><td>{t("hr.eos.wage")}</td><td className="num">{fmt(result.wage)}</td></tr>
              <tr><td>{t("hr.eos.duration")}</td><td className="num">{t("hr.eos.durationValue", { years: result.duration.years, months: result.duration.months, days: result.duration.days })}</td></tr>
              <tr><td>{t("hr.eos.fullReward")}</td><td className="num">{fmt(result.fullReward)}</td></tr>
              <tr><td>{t("hr.eos.ratio")}</td><td>{result.ratioNote} ({Math.round(result.ratio * 100)}٪)</td></tr>
              <tr><td className="foot-label">{t("hr.eos.finalAmount")}</td><td className="num strong">{fmt(result.finalAmount)}</td></tr>
            </tbody>
          </table>
          <p className="note">{t("hr.eos.disclaimer")}</p>
        </div>
      )}
    </div>
  );
}
