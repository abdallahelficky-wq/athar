import React from "react";
import CompanySelector from "../CompanySelector";
import EmployeeDirectoryTab from "./EmployeeDirectoryTab";
import LeavesTab from "./LeavesTab";
import LeaveSettlementTab from "./LeaveSettlementTab";
import LeaveReturnTab from "./LeaveReturnTab";
import ActionsTab from "./ActionsTab";
import PayrollTab from "./PayrollTab";
import EndOfServiceTab from "./EndOfServiceTab";
import HRReportsTab from "./HRReportsTab";

export const HR_TABS = [
  { id: "directory", label: "ملفات الموظفين" },
  { id: "leaves", label: "طلبات الإجازات" },
  { id: "leaveSettlement", label: "مستحقات الإجازة" },
  { id: "leaveReturn", label: "المباشرة بعد الإجازة" },
  { id: "actions", label: "إجراءات الموظفين" },
  { id: "payroll", label: "كشف الرواتب" },
  { id: "eos", label: "نهاية الخدمة" },
  { id: "reports", label: "التقارير" },
];

export default function HRWiredModule({ tab, setTab, companies, companyId, setCompanyId, onCompanyCreated }) {
  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">شئون الموظفين — بيانات حقيقية</span>
        <h2>شئون الموظفين</h2>
      </div>
      <CompanySelector companies={companies} companyId={companyId} setCompanyId={setCompanyId} onCompanyCreated={onCompanyCreated} />
      <div className="report-tabs">
        {HR_TABS.map((t) => <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === "directory" && <EmployeeDirectoryTab companyId={companyId} />}
      {tab === "leaves" && <LeavesTab companyId={companyId} />}
      {tab === "leaveSettlement" && <LeaveSettlementTab companyId={companyId} />}
      {tab === "leaveReturn" && <LeaveReturnTab companyId={companyId} />}
      {tab === "actions" && <ActionsTab companyId={companyId} />}
      {tab === "payroll" && <PayrollTab companyId={companyId} companies={companies} />}
      {tab === "eos" && <EndOfServiceTab companyId={companyId} />}
      {tab === "reports" && <HRReportsTab companyId={companyId} />}
    </div>
  );
}
