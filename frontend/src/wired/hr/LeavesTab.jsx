import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployees } from "../../api/employees";
import { listLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest, deleteLeaveRequest } from "../../api/leaveRequests";
import { LEAVE_TYPES } from "../../legacy/constants";

export default function LeavesTab({ companyId }) {
  const { t } = useTranslation();
  const STATUS_LABEL = t("hr.leaves.status", { returnObjects: true });
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState(LEAVE_TYPES[0]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then((es) => { setEmployees(es); if (es[0]) setEmployeeId((v) => v || es[0].id); });
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listLeaveRequests(companyId).then(setRequests).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!employeeId) return;
    try {
      await createLeaveRequest({ employeeId, type, startDate, endDate, note });
      setNote("");
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(t("hr.leaves.confirmDelete"))) return;
    try {
      await deleteLeaveRequest(r.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const approve = async (r) => {
    try { await approveLeaveRequest(r.id); reload(); } catch (err) { setError(err.message); }
  };
  const reject = async (r) => {
    try { await rejectLeaveRequest(r.id); reload(); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("hr.leaves.employee")}<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>{t("hr.leaves.type")}<select value={type} onChange={(e) => setType(e.target.value)}>{LEAVE_TYPES.map((t2) => <option key={t2}>{t2}</option>)}</select></label>
          <label>{t("hr.leaves.fromDate")}<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>{t("hr.leaves.toDate")}<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="memo-field">{t("hr.leaves.notes")}<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!employeeId}>{t("hr.leaves.saveBtn")}</button>
      </div>

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>{t("hr.leaves.table.employee")}</th><th>{t("hr.leaves.table.type")}</th><th>{t("hr.leaves.table.from")}</th><th>{t("hr.leaves.table.to")}</th><th>{t("hr.leaves.table.days")}</th><th>{t("hr.leaves.table.status")}</th><th></th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee?.name}</td><td>{r.type}</td><td>{r.startDate.slice(0, 10)}</td><td>{r.endDate.slice(0, 10)}</td>
                  <td className="num">{r.days}</td>
                  <td>
                    {STATUS_LABEL[r.status] || r.status}
                    {r.status === "pending" && !r.employee?.managerId && (
                      <span
                        className="status-badge"
                        style={{ marginRight: 6, color: "#A8432B", borderColor: "rgba(168,67,43,0.35)" }}
                        title={t("hr.leaves.noManagerTooltip")}
                      >
                        {t("hr.leaves.noManagerBadge")}
                      </span>
                    )}
                  </td>
                  <td className="row-actions">
                    {r.status === "pending" && (
                      <>
                        <button className="btn-ghost" onClick={() => approve(r)}>{t("hr.leaves.approve")}</button>
                        <button className="btn-ghost" onClick={() => reject(r)}>{t("hr.leaves.reject")}</button>
                      </>
                    )}
                    <button className="btn-ghost" onClick={() => remove(r)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td className="empty" colSpan={7}>{t("hr.leaves.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
