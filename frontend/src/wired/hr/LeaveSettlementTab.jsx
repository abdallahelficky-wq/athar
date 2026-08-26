import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployees } from "../../api/employees";
import {
  listLeaveSettlements, previewLeaveSettlement, createLeaveSettlement, disburseLeaveSettlement,
} from "../../api/leaveSettlements";
import { fmt } from "../../legacy/constants";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import { currencyLabel } from "../../shared/countries";

export default function LeaveSettlementTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [employees, setEmployees] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [error, setError] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [leaveStartDate, setLeaveStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [leaveEndDate, setLeaveEndDate] = useState("");
  const [settlementType, setSettlementType] = useState("actual_leave");
  const [cashLeaveDays, setCashLeaveDays] = useState("");
  const [bonuses, setBonuses] = useState("");
  const [deductions, setDeductions] = useState("");
  const [ticketAmount, setTicketAmount] = useState("");
  const [visaAmount, setVisaAmount] = useState("");
  const [preview, setPreview] = useState(null);

  const [disbursingId, setDisbursingId] = useState(null);
  const [disbMethod, setDisbMethod] = useState("cash");
  const [disbDate, setDisbDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attachmentsFor, setAttachmentsFor] = useState(null);

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
    previewLeaveSettlement(employeeId, leaveStartDate, leaveEndDate, settlementType, cashLeaveDays).then(setPreview).catch(() => setPreview(null));
  }, [employeeId, leaveStartDate, leaveEndDate, settlementType, cashLeaveDays]);

  const bon = Number(bonuses || 0), ded = Number(deductions || 0), tic = Number(ticketAmount || 0), vis = Number(visaAmount || 0);
  const net = preview ? preview.monthAmount + preview.leavePayAmount + bon - ded + tic + vis : 0;

  const save = async () => {
    if (!employeeId || !preview || net <= 0) return;
    try {
      await createLeaveSettlement({
        employeeId, leaveStartDate, leaveEndDate: leaveEndDate || null, settlementType,
        cashLeaveDays: Number(cashLeaveDays || 0), bonuses: bon, deductions: ded, ticketAmount: tic, visaAmount: vis,
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

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <h3 className="sub-head">{t("hr.leaveSettlement.requestSection")}</h3>
        <div className="form-grid">
          <label>{t("hr.leaveSettlement.employee")}<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{availableEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>{t("hr.leaveSettlement.settlementType")}<select value={settlementType} onChange={(e) => setSettlementType(e.target.value)}><option value="actual_leave">{t("hr.leaveSettlement.actualLeave")}</option><option value="cash_in_service">{t("hr.leaveSettlement.cashInService")}</option></select></label>
          <label>{t("hr.leaveSettlement.leaveStartDate")}<input type="date" value={leaveStartDate} onChange={(e) => setLeaveStartDate(e.target.value)} /></label>
          {settlementType === "actual_leave" ? <label>{t("hr.leaveSettlement.leaveEndDate")}<input type="date" min={leaveStartDate} value={leaveEndDate} onChange={(e) => setLeaveEndDate(e.target.value)} /></label> : <label>{t("hr.leaveSettlement.cashLeaveDays")}<input type="number" min="0" step="0.5" value={cashLeaveDays} onChange={(e) => setCashLeaveDays(e.target.value)} /></label>}
        </div>

        {preview && <div className="preview-box">
          <h3 className="sub-head">{t("hr.leaveSettlement.balanceSection")}</h3>
          <div className="preview-row"><span>{t("hr.leaveSettlement.accruedDays")}</span><strong>{preview.accrual.days.toFixed(2)} {t("hr.dashboard.days")}</strong></div>
          <div className="preview-row"><span>{t("hr.leaveSettlement.usedDays")}</span><strong>{preview.accrual.usedDays.toFixed(2)} {t("hr.dashboard.days")}</strong></div>
          <div className="preview-row"><span>{t("hr.leaveSettlement.availableDays")}</span><strong>{preview.accrual.availableDays.toFixed(2)} {t("hr.dashboard.days")}</strong></div>
          <div className="preview-row"><span>{t("hr.leaveSettlement.balanceAmount")}</span><strong>{fmt(preview.accrual.amount)} {currency}</strong></div>
          <div className="preview-row"><span>{t("hr.leaveSettlement.requestedDays")}</span><strong>{preview.leaveDays.toFixed(2)} {t("hr.dashboard.days")}</strong></div>
          <div className="preview-row"><span>{t("hr.leaveSettlement.leavePayAmount")}</span><strong>{fmt(preview.leavePayAmount)} {currency}</strong></div>
        </div>}

        {preview?.salary && <div className="preview-box">
          <h3 className="sub-head">{t("hr.leaveSettlement.automaticSalarySection")}</h3>
          <p className="note">{t("hr.leaveSettlement.automaticSalaryNote", { date: leaveStartDate, count: preview.salary.procedureCount })}</p>
          {preview.salary.components.map((line) => <div className="preview-row" key={line.id}>
            <span>{line.name}{line.hasProcedure ? ` — ${t("hr.leaveSettlement.includesProcedure")}` : ""}</span>
            <strong className={line.kind === "deduction" ? "text-danger" : ""}>{line.kind === "deduction" ? "-" : "+"}{fmt(line.amount)} {currency}</strong>
          </div>)}
          <div className="preview-row"><span>{t("hr.leaveSettlement.salaryAdditions")}</span><strong>{fmt(preview.salary.additions)} {currency}</strong></div>
          <div className="preview-row"><span>{t("hr.leaveSettlement.salaryDeductions")}</span><strong>-{fmt(preview.salary.deductions)} {currency}</strong></div>
          <div className="preview-row total"><span>{t("hr.leaveSettlement.salaryNetToLeaveDate")}</span><strong>{fmt(preview.salary.net)} {currency}</strong></div>
        </div>}

        <h3 className="sub-head">{t("hr.leaveSettlement.adjustmentsSection")}</h3>
        <div className="form-grid">
          <label>{t("hr.leaveSettlement.bonuses")}<input type="number" value={bonuses} onChange={(e) => setBonuses(e.target.value)} placeholder="0" /></label>
          <label>{t("hr.leaveSettlement.deductions")}<input type="number" value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="0" /></label>
          <label>{t("hr.leaveSettlement.ticketAmount")}<input type="number" value={ticketAmount} onChange={(e) => setTicketAmount(e.target.value)} placeholder="0" /></label>
          <label>{t("hr.leaveSettlement.visaAmount")}<input type="number" value={visaAmount} onChange={(e) => setVisaAmount(e.target.value)} placeholder="0" /></label>
        </div>

        {preview && (
          <div className="preview-box">
            <div className="preview-row"><span>{t("hr.leaveSettlement.previewDaysWorked")}</span><strong>{preview.daysWorked} {t("hr.dashboard.days")}</strong></div>
            <div className="preview-row"><span>{t("hr.leaveSettlement.previewMonthAmount")}</span><strong>{fmt(preview.monthAmount)} {currency}</strong></div>
            <div className="preview-row"><span>{t("hr.leaveSettlement.previewLeavePay")}</span><strong>{fmt(preview.leavePayAmount)} {currency}</strong></div>
            <div className="preview-row"><span>{t("hr.leaveSettlement.previewBonuses")}</span><strong>{fmt(bon)} {currency}</strong></div>
            <div className="preview-row"><span>{t("hr.leaveSettlement.previewDeductions")}</span><strong>-{fmt(ded)} {currency}</strong></div>
            <div className="preview-row"><span>{t("hr.leaveSettlement.previewTicketVisa")}</span><strong>{fmt(tic + vis)} {currency}</strong></div>
            <div className="preview-row net-row"><span>{t("hr.leaveSettlement.previewNet")}</span><strong>{fmt(net)} {currency}</strong></div>
          </div>
        )}

        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!employeeId || !preview || net <= 0}>
          {t("hr.leaveSettlement.saveBtn")}
        </button>
        {availableEmployees.length === 0 && <p className="empty">{t("hr.leaveSettlement.allOnLeave")}</p>}
      </div>

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>{t("hr.leaveSettlement.table.employee")}</th><th>{t("hr.leaveSettlement.table.leaveStart")}</th><th>{t("hr.leaveSettlement.table.net")}</th><th>{t("hr.leaveSettlement.table.status")}</th><th></th></tr></thead>
          <tbody>
            {settlements.map((s) => (
              <React.Fragment key={s.id}>
                <tr>
                  <td>{s.employee?.name}</td>
                  <td>{s.leaveStartDate.slice(0, 10)}</td>
                  <td className="num">{fmt(s.netAmount)}</td>
                  <td><span className="status-badge">{s.status === "disbursed" ? t("hr.leaveSettlement.statusDisbursed") : t("hr.leaveSettlement.statusCalculated")}</span></td>
                  <td className="row-actions">
                    {s.status === "calculated" && (
                      disbursingId === s.id ? (
                        <span className="inline-disb">
                          <select value={disbMethod} onChange={(e2) => setDisbMethod(e2.target.value)}>
                            <option value="cash">{t("hr.leaveSettlement.methodCash")}</option>
                            <option value="bank">{t("hr.leaveSettlement.methodBank")}</option>
                          </select>
                          <input type="date" value={disbDate} onChange={(e2) => setDisbDate(e2.target.value)} />
                          <button className="btn-primary" onClick={() => confirmDisbursement(s)}>{t("hr.leaveSettlement.confirmDisbursement")}</button>
                        </span>
                      ) : (
                        <button className="btn-ghost" onClick={() => { setDisbursingId(s.id); setDisbDate(s.leaveStartDate.slice(0, 10)); }}>{t("hr.leaveSettlement.disburseAction")}</button>
                      )
                    )}
                    <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === s.id ? null : s.id)}>
                      {attachmentsFor === s.id ? t("hr.leaveSettlement.attachmentsHide") : t("hr.leaveSettlement.attachmentsShow")}
                    </button>
                  </td>
                </tr>
                {attachmentsFor === s.id && (
                  <tr><td colSpan={5}><AttachmentsPanel entityType="leave_settlement" entityId={s.id} /></td></tr>
                )}
              </React.Fragment>
            ))}
            {settlements.length === 0 && <tr><td className="empty" colSpan={5}>{t("hr.leaveSettlement.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

