import React, { useEffect, useState } from "react";
import { listEmployees } from "../../api/employees";
import { listLeaveSettlements, registerLeaveReturn } from "../../api/leaveSettlements";

export default function LeaveReturnTab({ companyId }) {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openSettlement, setOpenSettlement] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const onLeaveEmployees = employees.filter((e) => e.leaveStatus === "onLeave");

  const load = () => {
    if (!companyId) return;
    listEmployees(companyId).then((es) => {
      setEmployees(es);
      const onLeave = es.filter((e) => e.leaveStatus === "onLeave");
      setEmployeeId((v) => (onLeave.some((e) => e.id === v) ? v : onLeave[0]?.id || ""));
    });
  };
  useEffect(load, [companyId]);

  useEffect(() => {
    if (!employeeId) { setOpenSettlement(null); return; }
    listLeaveSettlements(companyId, employeeId).then((list) => {
      setOpenSettlement(list.find((s) => !s.returnDate) || null);
    });
  }, [employeeId, companyId]);

  const registerReturn = async () => {
    if (!employeeId || !openSettlement) return;
    try {
      const result = await registerLeaveReturn({ employeeId, returnDate });
      setPreview(result.preview);
      setError("");
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف (في إجازة حالياً)
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {onLeaveEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>تاريخ المباشرة بعد الإجازة<input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></label>
        </div>

        {onLeaveEmployees.length === 0 && <p className="empty">لا يوجد موظفون في إجازة حالياً لهذه الشركة.</p>}
        {error && <p className="balance-bad">{error}</p>}

        {openSettlement && (
          <div className="preview-box">
            <div className="preview-row"><span>إجازة بدأت في</span><strong>{openSettlement.leaveStartDate.slice(0, 10)}</strong></div>
          </div>
        )}

        <button className="btn-primary" onClick={registerReturn} disabled={!employeeId || !openSettlement}>
          تسجيل المباشرة وإنهاء الإجازة
        </button>
        <p className="note">
          عند التسجيل، سيظهر الموظف تلقائياً في كشف رواتب شهر المباشرة براتب جزئي محسوب من تاريخ المباشرة حتى نهاية الشهر،
          ويعود رصيد إجازته للاحتساب من هذا التاريخ في المرة القادمة.
        </p>

        {preview && (
          <div className="preview-box">
            <div className="preview-row"><span>أيام العمل المستحقة من شهر المباشرة</span><strong>{preview.workedDays} يوم</strong></div>
            <div className="preview-row net-row"><span>الراتب المتوقع لشهر المباشرة</span><strong>{preview.amount.toFixed(2)} ر.س</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
