import React, { useEffect, useState } from "react";
import * as portalApi from "../api/employeePortal";

const LEAVE_TYPES = ["سنوية", "مرضية", "بدون راتب", "عارضة"];
const STATUS_LABEL = { pending: "قيد المراجعة", approved: "معتمدة", rejected: "مرفوضة" };

export default function LeaveRequestsScreen() {
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
          <h4 style={{ marginTop: 0 }}>رصيد الإجازة السنوية (تقريبي)</h4>
          <p style={{ fontSize: 28, fontWeight: 700, margin: "4px 0" }}>{balance.remainingDays.toFixed(1)} <span style={{ fontSize: 14, fontWeight: 500, color: "#6b7280" }}>يوم متبقٍ</span></p>
          <p style={{ fontSize: 12.5, color: "#6b7280", margin: 0 }}>
            تراكم تقديري: {balance.accruedDays.toFixed(1)} يوم — مستخدم: {balance.usedDays} يوم
          </p>
        </div>
      )}

      <form className="m-card" onSubmit={submit}>
        <h4 style={{ marginTop: 0 }}>طلب إجازة جديد</h4>
        <div className="m-field">
          <label>نوع الإجازة</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label>من تاريخ</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="m-field">
          <label>إلى تاريخ</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="m-field">
          <label>ملاحظات (اختياري)</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="m-btn" disabled={saving} type="submit">{saving ? "جارٍ الإرسال..." : "إرسال الطلب"}</button>
      </form>

      <div className="m-card">
        <h4 style={{ marginTop: 0 }}>طلباتي السابقة</h4>
        {loading ? <p className="m-empty">جارٍ التحميل...</p> : requests.length === 0 ? (
          <p className="m-empty">لا توجد طلبات إجازة بعد.</p>
        ) : requests.map((r) => (
          <div className="m-list-row" key={r.id} style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <strong>{r.type}</strong>
              <span className={`m-badge ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
            </div>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)} ({r.days} يوم)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
