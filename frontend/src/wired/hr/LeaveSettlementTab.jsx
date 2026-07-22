import React, { useEffect, useState } from "react";
import { listEmployees } from "../../api/employees";
import {
  listLeaveSettlements, previewLeaveSettlement, createLeaveSettlement, disburseLeaveSettlement,
} from "../../api/leaveSettlements";
import { fmt } from "../../legacy/constants";

export default function LeaveSettlementTab({ companyId }) {
  const [employees, setEmployees] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [error, setError] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [leaveStartDate, setLeaveStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bonuses, setBonuses] = useState("");
  const [deductions, setDeductions] = useState("");
  const [ticketAmount, setTicketAmount] = useState("");
  const [visaAmount, setVisaAmount] = useState("");
  const [preview, setPreview] = useState(null);

  const [disbursingId, setDisbursingId] = useState(null);
  const [disbMethod, setDisbMethod] = useState("cash");
  const [disbDate, setDisbDate] = useState(() => new Date().toISOString().slice(0, 10));

  const availableEmployees = employees.filter((e) => e.leaveStatus !== "onLeave");

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then((es) => {
      setEmployees(es);
      const avail = es.filter((e) => e.leaveStatus !== "onLeave");
      if (avail[0]) setEmployeeId((v) => v || avail[0].id);
    });
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    listLeaveSettlements(companyId).then(setSettlements).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId]);

  useEffect(() => {
    if (!employeeId || !leaveStartDate) { setPreview(null); return; }
    previewLeaveSettlement(employeeId, leaveStartDate).then(setPreview).catch(() => setPreview(null));
  }, [employeeId, leaveStartDate]);

  const bon = Number(bonuses || 0), ded = Number(deductions || 0), tic = Number(ticketAmount || 0), vis = Number(visaAmount || 0);
  const net = preview ? preview.monthAmount + bon - ded + tic + vis : 0;

  const save = async () => {
    if (!employeeId || !preview || net <= 0) return;
    try {
      await createLeaveSettlement({
        employeeId, leaveStartDate, bonuses: bon, deductions: ded, ticketAmount: tic, visaAmount: vis,
      });
      setBonuses(""); setDeductions(""); setTicketAmount(""); setVisaAmount("");
      setError("");
      const es = await listEmployees(companyId);
      setEmployees(es);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const confirmDisbursement = async (s) => {
    try {
      await disburseLeaveSettlement(s.id, { method: disbMethod, date: disbDate });
      setDisbursingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{availableEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>تاريخ بداية الإجازة<input type="date" value={leaveStartDate} onChange={(e) => setLeaveStartDate(e.target.value)} /></label>
          <label>إضافات / مكافآت<input type="number" value={bonuses} onChange={(e) => setBonuses(e.target.value)} placeholder="0" /></label>
          <label>خصومات<input type="number" value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="0" /></label>
          <label>تذكرة السفر<input type="number" value={ticketAmount} onChange={(e) => setTicketAmount(e.target.value)} placeholder="0" /></label>
          <label>تأشيرة خروج وعودة<input type="number" value={visaAmount} onChange={(e) => setVisaAmount(e.target.value)} placeholder="0" /></label>
        </div>

        {preview && (
          <div className="preview-box">
            <div className="preview-row"><span>أيام العمل المستحقة من الشهر</span><strong>{preview.daysWorked} يوم</strong></div>
            <div className="preview-row"><span>راتب أيام الشهر قبل الإجازة</span><strong>{fmt(preview.monthAmount)} ر.س</strong></div>
            <div className="preview-row"><span>رصيد الإجازة المتراكم</span><strong>{preview.accrual.days.toFixed(1)} يوم</strong></div>
            <div className="preview-row"><span>الإضافات</span><strong>{fmt(bon)} ر.س</strong></div>
            <div className="preview-row"><span>الخصومات</span><strong>-{fmt(ded)} ر.س</strong></div>
            <div className="preview-row"><span>تذكرة السفر + التأشيرة</span><strong>{fmt(tic + vis)} ر.س</strong></div>
            <div className="preview-row net-row"><span>صافي المبلغ المستحق</span><strong>{fmt(net)} ر.س</strong></div>
          </div>
        )}

        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!employeeId || !preview || net <= 0}>
          حفظ واعتماد المستحقات (يرحّل قيداً تلقائياً)
        </button>
        {availableEmployees.length === 0 && <p className="empty">كل موظفي هذه الشركة في إجازة حالياً.</p>}
      </div>

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الموظف</th><th>بداية الإجازة</th><th>الصافي</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {settlements.map((s) => (
              <tr key={s.id}>
                <td>{s.employee?.name}</td>
                <td>{s.leaveStartDate.slice(0, 10)}</td>
                <td className="num">{fmt(s.netAmount)}</td>
                <td><span className="status-badge">{s.status === "disbursed" ? "مصروفة" : "محتسبة"}</span></td>
                <td className="row-actions">
                  {s.status === "calculated" && (
                    disbursingId === s.id ? (
                      <span className="inline-disb">
                        <select value={disbMethod} onChange={(e2) => setDisbMethod(e2.target.value)}>
                          <option value="cash">كاش</option>
                          <option value="bank">بنك</option>
                        </select>
                        <input type="date" value={disbDate} onChange={(e2) => setDisbDate(e2.target.value)} />
                        <button className="btn-primary" onClick={() => confirmDisbursement(s)}>تأكيد الصرف</button>
                      </span>
                    ) : (
                      <button className="btn-ghost" onClick={() => { setDisbursingId(s.id); setDisbDate(s.leaveStartDate.slice(0, 10)); }}>صرف الدفعة</button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {settlements.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد تسويات إجازات مسجّلة بعد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
