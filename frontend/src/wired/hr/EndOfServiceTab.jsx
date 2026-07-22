import React, { useEffect, useState } from "react";
import { listEmployees, getEmployeeEos } from "../../api/employees";
import { fmt } from "../../legacy/constants";

const REASONS = [
  { id: "resign", label: "استقالة" },
  { id: "employer", label: "إنهاء من صاحب العمل" },
  { id: "contractEnd", label: "انتهاء مدة العقد" },
];

export default function EndOfServiceTab({ companyId }) {
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

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>تاريخ انتهاء الخدمة<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label>سبب انتهاء الخدمة<select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={calculate} disabled={!employeeId}>احتساب مكافأة نهاية الخدمة</button>
      </div>

      {result && (
        <div className="panel">
          <h3 className="sub-head">نتيجة الاحتساب</h3>
          <table className="ledger-table">
            <tbody>
              <tr><td>الأجر الشامل (أساسي + سكن)</td><td className="num">{fmt(result.wage)}</td></tr>
              <tr><td>مدة الخدمة (سنوات)</td><td className="num">{result.duration.years} سنة و{result.duration.months} شهر و{result.duration.days} يوم</td></tr>
              <tr><td>المكافأة الكاملة (قبل النسبة)</td><td className="num">{fmt(result.fullReward)}</td></tr>
              <tr><td>نسبة الاستحقاق</td><td>{result.ratioNote} ({Math.round(result.ratio * 100)}٪)</td></tr>
              <tr><td className="foot-label">المبلغ النهائي المستحق</td><td className="num strong">{fmt(result.finalAmount)}</td></tr>
            </tbody>
          </table>
          <p className="note">هذا احتساب تقديري توضيحي وفق المادتين 84 و85 من نظام العمل السعودي، ولا يُنشئ أي قيد محاسبي ولا يُخزَّن — يتطلب مراجعة قانونية دقيقة قبل الاعتماد الفعلي.</p>
        </div>
      )}
    </div>
  );
}
