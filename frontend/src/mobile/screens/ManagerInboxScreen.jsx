import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as portalApi from "../api/employeePortal";

export default function ManagerInboxScreen() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const reload = () => {
    setLoading(true);
    portalApi.getManagerInbox().then(setRequests).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const decide = async (id, action) => {
    setError("");
    setBusyId(id);
    try {
      await (action === "approve" ? portalApi.approveLeaveRequest(id) : portalApi.rejectLeaveRequest(id));
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {error && <p className="m-error">{error}</p>}
      <div className="m-card">
        <h4 style={{ marginTop: 0 }}>{t("mobile.inbox.title")}</h4>
        {loading ? <p className="m-empty">{t("common.loading")}</p> : requests.length === 0 ? (
          <p className="m-empty">{t("mobile.inbox.noPending")}</p>
        ) : requests.map((r) => (
          <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid rgba(16,32,46,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{r.employee?.name}</strong>
              <span style={{ fontSize: 13, color: "#6b7280" }}>{r.type}</span>
            </div>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0" }}>
              {t("mobile.dateRangeWithDays", { start: r.startDate.slice(0, 10), end: r.endDate.slice(0, 10), days: r.days })}
              {r.note && ` — ${r.note}`}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="m-btn" style={{ background: "#2F5D5A" }} disabled={busyId === r.id} onClick={() => decide(r.id, "approve")}>{t("mobile.inbox.approveBtn")}</button>
              <button className="m-btn secondary" disabled={busyId === r.id} onClick={() => decide(r.id, "reject")}>{t("hr.leaves.reject")}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
