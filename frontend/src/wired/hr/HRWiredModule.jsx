import React from "react";
import HRDashboardTab from "./HRDashboardTab";
import EmployeeDirectoryTab from "./EmployeeDirectoryTab";
import LeavesTab from "./LeavesTab";
import LeaveSettlementTab from "./LeaveSettlementTab";
import LeaveReturnTab from "./LeaveReturnTab";
import ActionsTab from "./ActionsTab";
import PayrollTab from "./PayrollTab";
import EndOfServiceTab from "./EndOfServiceTab";
import HRReportsTab from "./HRReportsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const HR_TABS = [
  { id: "dashboard", label: "لوحة القيادة" },
  { id: "directory", label: "ملفات الموظفين" },
  { id: "leaves", label: "طلبات الإجازات" },
  { id: "leaveSettlement", label: "مستحقات الإجازة" },
  { id: "leaveReturn", label: "المباشرة بعد الإجازة" },
  { id: "actions", label: "إجراءات الموظفين" },
  { id: "payroll", label: "كشف الرواتب" },
  { id: "eos", label: "نهاية الخدمة" },
  { id: "reports", label: "التقارير" },
];

export default function HRWiredModule({ tab, setTab, companies, companyId, onViewAccount }) {
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["شئون الموظفين", "بيانات حقيقية"]} />
        <h2>شئون الموظفين</h2>
      </div>
      <SubTabs tabs={HR_TABS} active={tab} onChange={setTab} />
      {tab === "dashboard" && <HRDashboardTab companyId={companyId} />}
      {tab === "directory" && <EmployeeDirectoryTab companyId={companyId} onViewAccount={onViewAccount} />}
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
