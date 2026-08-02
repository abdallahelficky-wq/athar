import React, { useEffect, useState } from "react";
import { listEmployees } from "../../api/employees";
import { listLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest, deleteLeaveRequest } from "../../api/leaveRequests";
import { LEAVE_TYPES } from "../../legacy/constants";

const STATUS_LABEL = { pending: "قيد المراجعة", approved: "معتمدة", rejected: "مرفوضة" };

export default function LeavesTab({ companyId }) {
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
    if (!window.confirm("حذف طلب الإجازة؟")) return;
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

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>نوع الإجازة<select value={type} onChange={(e) => setType(e.target.value)}>{LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>من تاريخ<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>إلى تاريخ<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="memo-field">ملاحظات<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!employeeId}>تسجيل الإجازة</button>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الموظف</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th><th></th></tr></thead>
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
                        title="هذا الموظف بلا مدير مباشر مسجّل — لن يظهر الطلب في أي صندوق وارد بالجوال، والموافقة/الرفض من هنا فقط"
                      >
                        بلا مدير مباشر
                      </span>
                    )}
                  </td>
                  <td className="row-actions">
                    {r.status === "pending" && (
                      <>
                        <button className="btn-ghost" onClick={() => approve(r)}>اعتماد</button>
                        <button className="btn-ghost" onClick={() => reject(r)}>رفض</button>
                      </>
                    )}
                    <button className="btn-ghost" onClick={() => remove(r)}>حذف</button>
                  </td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td className="empty" colSpan={7}>لا توجد إجازات مسجّلة بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
