import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployees } from "../../api/employees";
import { listLeaveSettlements, registerLeaveReturn } from "../../api/leaveSettlements";
import { currencyLabel } from "../../shared/countries";

export default function LeaveReturnTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
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

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("hr.leaveReturn.employee")}
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {onLeaveEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>{t("hr.leaveReturn.returnDate")}<input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></label>
        </div>

        {onLeaveEmployees.length === 0 && <p className="empty">{t("hr.leaveReturn.noneOnLeave")}</p>}
        {error && <p className="balance-bad">{error}</p>}

        {openSettlement && (
          <div className="preview-box">
            <div className="preview-row"><span>{t("hr.leaveReturn.leaveStarted")}</span><strong>{openSettlement.leaveStartDate.slice(0, 10)}</strong></div>
          </div>
        )}

        <button className="btn-primary" onClick={registerReturn} disabled={!employeeId || !openSettlement}>
          {t("hr.leaveReturn.registerBtn")}
        </button>
        <p className="note">{t("hr.leaveReturn.note")}</p>

        {preview && (
          <div className="preview-box">
            <div className="preview-row"><span>{t("hr.leaveReturn.previewWorkedDays")}</span><strong>{preview.workedDays} {t("hr.dashboard.days")}</strong></div>
            <div className="preview-row net-row"><span>{t("hr.leaveReturn.previewAmount")}</span><strong>{preview.amount.toFixed(2)} {currency}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
