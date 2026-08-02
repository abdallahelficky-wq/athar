import React, { useEffect, useState } from "react";
import * as portalApi from "../api/employeePortal";

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "—";
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("ar-SA", { weekday: "short", day: "numeric", month: "short" });
}
function hoursBetween(a, b) {
  if (!a || !b) return null;
  const hrs = (new Date(b) - new Date(a)) / 3_600_000;
  return hrs.toFixed(1);
}

export default function CheckInScreen() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setLoading(true);
    portalApi.myAttendance().then(setHistory).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const today = history[0] && new Date(history[0].date).toDateString() === new Date().toDateString() ? history[0] : null;
  const hasCheckedIn = Boolean(today?.checkInAt);
  const hasCheckedOut = Boolean(today?.checkOutAt);

  const act = async (fn) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {error && <p className="m-error">{error}</p>}
      <div className="m-card" style={{ textAlign: "center" }}>
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: 13.5 }}>
          {new Date().toLocaleDateString("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
        {!hasCheckedIn && (
          <button className="m-big-btn" disabled={busy} onClick={() => act(portalApi.checkIn)}>
            <span style={{ fontSize: 26 }}>⏱</span>
            {busy ? "جارٍ التسجيل..." : "تسجيل حضور"}
          </button>
        )}
        {hasCheckedIn && !hasCheckedOut && (
          <button className="m-big-btn checked-in" disabled={busy} onClick={() => act(portalApi.checkOut)}>
            <span style={{ fontSize: 26 }}>🚪</span>
            {busy ? "جارٍ التسجيل..." : "تسجيل انصراف"}
          </button>
        )}
        {hasCheckedIn && hasCheckedOut && (
          <div className="m-big-btn" style={{ background: "#2F5D5A" }}>
            <span style={{ fontSize: 26 }}>✓</span>
            تم تسجيل الحضور والانصراف اليوم
          </div>
        )}
        {today && (
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 0 }}>
            حضور: {fmtTime(today.checkInAt)} — انصراف: {fmtTime(today.checkOutAt)}
          </p>
        )}
      </div>

      <div className="m-card">
        <h4 style={{ marginTop: 0 }}>سجل الحضور الأخير</h4>
        {loading ? <p className="m-empty">جارٍ التحميل...</p> : history.length === 0 ? (
          <p className="m-empty">لا يوجد سجل حضور بعد.</p>
        ) : history.slice(0, 14).map((r) => (
          <div className="m-list-row" key={r.id}>
            <span>{fmtDate(r.date)}</span>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {fmtTime(r.checkInAt)} → {fmtTime(r.checkOutAt)}
              {r.checkOutAt && ` (${hoursBetween(r.checkInAt, r.checkOutAt)} س)`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
