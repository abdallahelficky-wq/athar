import React from "react";
import { useTranslation } from "react-i18next";
import HRDashboardTab from "./HRDashboardTab";
import EmployeeDirectoryTab from "./EmployeeDirectoryTab";
import LeavesTab from "./LeavesTab";
import LeaveSettlementTab from "./LeaveSettlementTab";
import LeaveReturnTab from "./LeaveReturnTab";
import ActionsTab from "./ActionsTab";
import PayrollTab from "./PayrollTab";
import PayrollSettingsTab from "./PayrollSettingsTab";
import EndOfServiceTab from "./EndOfServiceTab";
import HRReportsTab from "./HRReportsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const HR_TABS = [
  { id: "dashboard", labelKey: "nav.tabs.hrDashboard" },
  { id: "directory", labelKey: "nav.tabs.directory" },
  { id: "leaves", labelKey: "nav.tabs.leaves" },
  { id: "leaveSettlement", labelKey: "nav.tabs.leaveSettlement" },
  { id: "leaveReturn", labelKey: "nav.tabs.leaveReturn" },
  { id: "actions", labelKey: "nav.tabs.hrActions" },
  { id: "payroll", labelKey: "nav.tabs.payroll" },
  { id: "payrollSettings", labelKey: "nav.tabs.payrollSettings" },
  { id: "eos", labelKey: "nav.tabs.eos" },
  { id: "reports", labelKey: "nav.tabs.reports" },
];

export default function HRWiredModule({ tab, setTab, companies, companyId, onViewAccount }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("nav.groups.hr"), t("dashboard.breadcrumb.realData")]} />
        <h2>{t("nav.groups.hr")}</h2>
      </div>
      <SubTabs tabs={HR_TABS} active={tab} onChange={setTab} />
      {tab === "dashboard" && <HRDashboardTab companyId={companyId} />}
      {tab === "directory" && <EmployeeDirectoryTab companyId={companyId} onViewAccount={onViewAccount} />}
      {tab === "leaves" && <LeavesTab companyId={companyId} />}
      {tab === "leaveSettlement" && <LeaveSettlementTab companyId={companyId} />}
      {tab === "leaveReturn" && <LeaveReturnTab companyId={companyId} />}
      {tab === "actions" && <ActionsTab companyId={companyId} />}
      {tab === "payroll" && <PayrollTab companyId={companyId} companies={companies} />}
      {tab === "payrollSettings" && <PayrollSettingsTab companyId={companyId} />}
      {tab === "eos" && <EndOfServiceTab companyId={companyId} />}
      {tab === "reports" && <HRReportsTab companyId={companyId} />}
    </div>
  );
}
