import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as portalApi from "../api/employeePortal";
import { LEAVE_TYPES } from "../../legacy/constants";

export default function LeaveRequestsScreen() {
  const { t } = useTranslation();
  const STATUS_LABEL = { pending: t("hr.leaves.status.pending"), approved: t("hr.leaves.status.approved"), rejected: t("hr.leaves.status.rejected") };

  const [requests, setRequests] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState(LEAVE_TYPES[0]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const reload = () => {
    setLoading(true);
    Promise.all([portalApi.listMyLeaveRequests(), portalApi.getLeaveBalance()])
      .then(([reqs, bal]) => { setRequests(reqs); setBalance(bal); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await portalApi.createLeaveRequest({ type, startDate, endDate, note: note || undefined });
      setNote("");
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {error && <p className="m-error">{error}</p>}

      {balance && (
        <div className="m-card">
          <h4 style={{ marginTop: 0 }}>{t("mobile.leave.balanceTitle")}</h4>
          <p style={{ fontSize: 28, fontWeight: 700, margin: "4px 0" }}>{balance.remainingDays.toFixed(1)} <span style={{ fontSize: 14, fontWeight: 500, color: "#6b7280" }}>{t("mobile.leave.daysRemaining")}</span></p>
          <p style={{ fontSize: 12.5, color: "#6b7280", margin: 0 }}>
            {t("mobile.leave.accruedSummary", { accrued: balance.accruedDays.toFixed(1), used: balance.usedDays })}
          </p>
        </div>
      )}

      <form className="m-card" onSubmit={submit}>
        <h4 style={{ marginTop: 0 }}>{t("mobile.leave.newRequestTitle")}</h4>
        <div className="m-field">
          <label>{t("hr.leaves.type")}</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {LEAVE_TYPES.map((lt) => <option key={lt}>{lt}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label>{t("hr.leaves.fromDate")}</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="m-field">
          <label>{t("hr.leaves.toDate")}</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="m-field">
          <label>{t("mobile.leave.notesOptionalLabel")}</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="m-btn" disabled={saving} type="submit">{saving ? t("reports.automation.sending") : t("mobile.leave.submitBtn")}</button>
      </form>

      <div className="m-card">
        <h4 style={{ marginTop: 0 }}>{t("mobile.leave.previousRequestsTitle")}</h4>
        {loading ? <p className="m-empty">{t("common.loading")}</p> : requests.length === 0 ? (
          <p className="m-empty">{t("mobile.leave.noRequests")}</p>
        ) : requests.map((r) => (
          <div className="m-list-row" key={r.id} style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <strong>{r.type}</strong>
              <span className={`m-badge ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
            </div>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {t("mobile.dateRangeWithDays", { start: r.startDate.slice(0, 10), end: r.endDate.slice(0, 10), days: r.days })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
